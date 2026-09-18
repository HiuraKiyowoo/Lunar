/**
 * lunar-sc.js — Pengambil tanda tangan CloudFront (`sc`) dengan browser headless.
 *
 * ---------------------------------------------------------------------------
 * MASALAH
 * ---------------------------------------------------------------------------
 * CDN video hakunaymatata.com menolak akses langsung (428/429) dan hanya mau
 * dilewati perantara `noon.mooncase.online`:
 *
 *     /sacdn/dash/<resourceId>_0_0_<q>_h26{5|4}_<bitrate>/...?host=&sc=<sc>
 *
 * `sc` = base64url dari cookie CloudFront:
 *     CloudFront-Policy=...;CloudFront-Signature=...;CloudFront-Key-Pair-Id=...;
 *
 * `CloudFront-Signature` adalah tanda tangan RSA yang dibuat oleh server
 * VidLink memakai private key mereka — MUSTAHIL dipalsukan. Satu-satunya
 * sumber `sc` adalah permintaan yang dibuat pemutar VidLink sendiri.
 *
 * VidLink membuat `sc` **di sisi klien** (webpack modul 3922):
 *     sc = base64url(getHeader(headers,"cookie"))
 * lalu mengirimnya ke perantara. Artinya cookie CloudFront harus sudah ada di
 * `headers.cookie` yang diberikan server VidLink ke pemutar.
 *
 * ---------------------------------------------------------------------------
 * SOLUSI (modul ini)
 * ---------------------------------------------------------------------------
 * Jalankan Chromium headless SEKALI tiap film baru:
 *   1. buka https://vidlink.pro/movie/<tmdbId>
 *   2. intip semua request; ambil yang menuju /sacdn/ dan punya parameter `sc`
 *   3. simpan `sc` + resourceId + expire (7 hari) ke berkas cache
 *   4. hancurkan browser
 *
 * Hasilnya dipakai server untuk membangun URL /sacdn/ yang sah, sehingga
 * APK tetap memutar video lewat ExoPlayer native (TIDAK ada WebView).
 *
 * Jalur alternatif (kalau /sacdn/ belum terisi): rekam juga URL /mp/... mp4
 * beserta header Cookie-nya, yang bisa diteruskan apa adanya.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** Berapa lama `sc` dianggap sah (detik). CloudFront DateLessThan ≈ 7 hari. */
const SC_TTL = Number(process.env.SC_TTL || 6 * 24 * 3600);

/** Lama menunggu pemutar mengeluarkan permintaan /sacdn/ (ms). */
const NAV_TIMEOUT = Number(process.env.SC_NAV_TIMEOUT || 45_000);

const CACHE_FILE = process.env.SC_CACHE_FILE
  || path.join(process.env.LUNAR_DATA_DIR || __dirname, 'sc-cache.json');

/** Angka muat ulang maksimum sebelum menyerah. */
const MAX_RETRY = Number(process.env.SC_MAX_RETRY || 2);

/* ------------------------------------------------------------------ cache ---- */

let store = {};

function load() {
  try { store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; }
  catch (_) { store = {}; }
}
load();

function save() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2));
  } catch (e) { /* cache sekunder — gagal simpan tidak fatal */ }
}

function cacheKey(tmdb, type, season, episode) {
  return `${type || 'movie'}:${tmdb}:${season || 0}:${episode || 0}`;
}

/** Ambil entri cache yang masih sah. */
function get(tmdb, type, season, episode) {
  const e = store[cacheKey(tmdb, type, season, episode)];
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) return null;
  return e;
}

function put(tmdb, type, season, episode, data) {
  store[cacheKey(tmdb, type, season, episode)] = {
    ...data,
    savedAt: Date.now(),
    exp: Date.now() + SC_TTL * 1000,
  };
  save();
}

/* ------------------------------------------------------- headless browser ---- */

/**
 * Cari executable Chromium/Chrome di sistem.
 * Urutan: env CHROME_PATH → cache Playwright/Puppeteer (paling andal) →
 *         chromium → chromium-browser → google-chrome → chrome → headless_shell.
 */
function findChrome() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);

  // Cache Playwright / Puppeteer lebih dulu: installer distro sering hanya
  // menyediakan pembungkus snap yang gagal jalan di server.
  const home = process.env.HOME || '/root';
  for (const base of [
    path.join(home, '.cache', 'ms-playwright'),
    path.join(home, '.cache', 'puppeteer'),
    path.join(home, '.cache', 'puppeteer-core'),
  ]) {
    try {
      for (const d of fs.readdirSync(base).sort().reverse()) {
        for (const rel of [
          'chrome-linux/chrome', 'chrome-linux64/chrome',
          'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell',
        ]) {
          const p = path.join(base, d, rel);
          if (fs.existsSync(p)) cands.push(p);
        }
      }
    } catch (_) { /* direktori tidak ada */ }
  }

  for (const n of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome', 'headless_shell']) {
    cands.push(n);
  }

  for (const c of cands) {
    try {
      if (c.includes('/')) {
        if (fs.existsSync(c)) return c;
      } else {
        const r = require('child_process').spawnSync('which', [c], { encoding: 'utf8' });
        if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
      }
    } catch (_) { /* lanjut */ }
  }
  return null;
}

/**
 * Buka halaman pemutar VidLink dengan Chrome/Chromium headless mode DevTools,
 * lalu kumpulkan URL media yang mengandung parameter `sc`.
 *
 * Memakai protokol DevTools mentah lewat WebSocket supaya tidak butuh
 * dependensi npm apa pun (hanya modul inti Node).
 */
async function sniffOnce(tmdb, type, season, episode, chromePath) {
  const http = require('http');
  const os = require('os');

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunar-chrome-'));
  const port = 9100 + Math.floor(Math.random() * 800);

  const url = (type === 'tv' && season && episode)
    ? `https://vidlink.pro/tv/${tmdb}/${season}/${episode}`
    : `https://vidlink.pro/movie/${tmdb}`;

  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-extensions',
    '--disable-blink-features=AutomationControlled',
    '--mute-audio',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    // UA & Client Hints selaras dengan pemutar asli (Android Chrome 152)
    '--user-agent=Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
    'about:blank',
  ];

  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let childErr = '';
  child.stderr.on('data', (d) => { childErr += d.toString().slice(0, 400); });

  const cleanup = () => {
    try { child.kill('SIGKILL'); } catch (_) {}
    // jangan hapus userDir dulu supaya bisa diperiksa; jadwalkan penghapusan
    setTimeout(() => { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {} }, 15_000);
  };

  // Tunggu DevTools terbuka.
  const version = await waitFor(async () => {
    return getJson(`http://127.0.0.1:${port}/json/version`).catch(() => null);
  }, 12_000);

  if (!version) {
    cleanup();
    throw new Error('chrome gagal dibuka (DevTools tidak menjawab)' +
      (childErr ? ': ' + childErr.slice(-200) : ''));
  }

  // Buat tab baru dan sambungkan.
  const target = await getJson(`http://127.0.0.1:${port}/json/new?about:blank`)
    .catch(async () => {
      // Chrome baru menolak /json/new dgn GET → buka lewat pertama kali saja
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      return list[0];
    });

  const wsUrl = target.webSocketDebuggerUrl;
  const found = await new Promise((resolve) => {
    // Node >= 22 punya WebSocket bawaan (undici) — nol dependensi npm.
    // Kalau Node lebih tua, coba modul 'ws' sebagai cadangan.
    let WS = globalThis.WebSocket;
    if (!WS) { try { WS = require('ws'); } catch (_) { WS = null; } }
    if (!WS) { resolve(null); return; }
    const WebSocket = WS;
    let settled = false;
    let found = null;
    let graceTimer = null;
    const GRACE = Number(process.env.SC_GRACE || 12_000);
    const done = (v) => { if (!settled) { settled = true; try { ws.close(); } catch (_) {} resolve(v); } };

    const ws = new WebSocket(wsUrl);
    let id = 0;
    const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));

    // API WebSocket bawaan Node (undici) memakai addEventListener,
    // sedangkan modul 'ws' memakai on(). Dukung keduanya.
    const listen = (ev, fn) => (typeof ws.addEventListener === 'function'
      ? ws.addEventListener(ev, (e) => fn(e.data !== undefined ? e.data : e))
      : ws.on(ev, fn));

    const timer = setTimeout(() => done(null), NAV_TIMEOUT);

    listen('open', () => {
      send('Network.enable', {});
      send('Page.enable', {});
      send('Runtime.enable', {});
      send('Page.navigate', { url });
    });

    listen('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      const m = msg.method;

      if (m === 'Network.responseReceived') {
        const rp = msg.params.response || {};
        const ru = rp.url || '';
        if (/\/sacdn\/|\/mp\/|hakunaymatata/.test(ru)) {
          try { require('fs').appendFileSync('/tmp/sniff-resp.log',
            rp.status + ' ' + ru.slice(0,160) + '\n'); } catch(_) {}
        }
      }
      if (process.env.SC_DEBUG && m === 'Network.requestWillBeSent') {
        const rq = msg.params.request || {};
        try { require('fs').appendFileSync('/tmp/sniff-req.log',
          rq.method + ' ' + (rq.url||'').slice(0,190) + '\n'); } catch(_) {}
      }
      if (m !== 'Network.requestWillBeSent') return;
      const req = msg.params.request || {};
      const u = req.url || '';
      if (!/\/sacdn\//.test(u) && !/\/mp\//.test(u)) return;

      // Simpan juga URL MPD / m4s pertama supaya lengkap.
      try {
        const parsed = new URL(u);
        const sc = parsed.searchParams.get('sc');
        const host = parsed.searchParams.get('host');
        if (sc) {
          found = { kind: 'sacdn', url: u, sc, host, path: parsed.pathname, headers: req.headers || {} };
          return;
        }
        if (/\.mp4/.test(parsed.pathname) && !found) {
          found = { kind: 'mp', url: u, host, path: parsed.pathname, headers: req.headers || {} };
        }
        // Jangan langsung selesai: tunggu respons /mp/ supaya tahu status akhirnya
        // (player sering dapat 428 dulu lalu mencoba lagi).
        if (found && !graceTimer) graceTimer = setTimeout(() => { clearTimeout(timer); done(found); }, GRACE);
      } catch (_) { /* URL aneh → lewati */ }
    });

    listen('error', () => done(null));
    listen('close', () => done(null));
  });

  cleanup();
  return found;
}

/** HTTP GET JSON sederhana. */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; if (d.length > 4e6) r.destroy(); });
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

/** Panggil fn berulang sampai hasilnya truthy atau waktu habis. */
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/* --------------------------------------------------------------- publik ---- */

let chromePathCache = null;
function chromePath() {
  if (chromePathCache === null) chromePathCache = findChrome() || '';
  return chromePathCache || null;
}

/** Apakah headless browser tersedia di mesin ini? */
function available() {
  return Boolean(chromePath());
}

/**
 * Dapatkan `sc` untuk film/episode tertentu.
 * @returns {Promise<null|{sc, resourceId, path, url, headers, cached}>}
 */
async function fetchSc(tmdb, type = 'movie', season = 0, episode = 0, opts = {}) {
  const cached = get(tmdb, type, season, episode);
  if (cached && !opts.force) return { ...cached, cached: true };

  const cp = chromePath();
  if (!cp) throw new Error('chromium tidak ditemukan (set CHROME_PATH)');

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const hit = await sniffOnce(tmdb, type, season, episode, cp);
      if (hit) {
        // resourceId diambil dari path: /sacdn/dash/<rid>_0_0_<q>_h26X_<br>/...
        let resourceId = null;
        const m = hit.path.match(/\/dash\/([0-9]+)_/);
        if (m) resourceId = m[1];
        const data = {
          sc: hit.sc || null,
          resourceId,
          path: hit.path,
          url: hit.url,
          headers: hit.headers || {},
          kind: hit.kind,
          tmdb: String(tmdb), type,
        };
        put(tmdb, type, season, episode, data);
        return { ...data, cached: false };
      }
      lastErr = lastErr || new Error('pemutar tidak mengeluarkan permintaan /sacdn/ maupun /mp/');
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastErr || new Error('gagal mengambil sc');
}

/** Statistik cache untuk /health. */
function stats() {
  const keys = Object.keys(store);
  let valid = 0;
  for (const k of keys) if (store[k].exp > Date.now()) valid++;
  return { entries: keys.length, valid, file: CACHE_FILE, chrome: chromePath() || null };
}

module.exports = { fetchSc, get, put, available, stats, CACHE_FILE, chromePath };
