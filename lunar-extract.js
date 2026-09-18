/**
 * lunar-extract.js — pengambil URL video dari pemutar pihak ketiga
 * memakai Chromium headless + penyaring iklan, dijalankan DI SERVER.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MODUL INI ADA
 * ---------------------------------------------------------------------------
 * Sumber URL dari API MovieZone sudah KEDALUARSA saat dikirim: parameter
 * `t` (stempel waktu) yang disertakan berumur 14–48 JAM, sehingga CDN
 * menjawab 428/429. Membuka halaman pemutar BARU menghasilkan tanda tangan
 * segar — jadi server membuka sendiri halaman itu secara headless.
 *
 * Ini juga menyelesaikan dua masalah sekaligus:
 *   1. Iklan (PopAds, Adcash, llvpn, dll.) hanya ada di halaman pemutar.
 *      Kita tidak pernah menampilkan halaman itu — hanya MEMBACA lalu lintas
 *      jaringannya. Jadi iklan tidak pernah sampai ke aplikasi.
 *   2. Enam pemutar cadangan dipakai berurutan, sehingga satu pemutar
 *      bermasalah tidak mematikan layanan.
 *
 * Hasilnya tetap diputar oleh ExoPlayer NATIVE di perangkat — tidak ada
 * WebView di APK.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/* --------------------------------------------------------------- setelan ---- */

/** Lama menunggu pemutar mengeluarkan URL video (ms). */
const NAV_TIMEOUT = Number(process.env.EX_NAV_TIMEOUT || 40_000);

/** Lama menunggu setelah URL pertama muncul agar iklan/metadata selesai. */
const SETTLE = Number(process.env.EX_SETTLE || 2_500);

/** Berapa lama hasil disimpan (detik). */
const TTL = Number(process.env.EX_TTL || 3_200);

/** Batas percobaan ulang per pemutar. */
const MAX_RETRY = Number(process.env.EX_MAX_RETRY || 1);

/** Daftar pemutar, berurutan. `{tmdb}`/`{s}`/`{e}` diganti sesuai permintaan. */
const ENGINES = [
  { name: 'VidLink',     type: 'clean', media: /\/sacdn\/|\/mp\/|hakunaymatata|\.m3u8|\.mpd/ },
  { name: 'VidSrcWiki',  type: 'frame', media: /\.m3u8|\.mp4|\.mpd|googlevideo|hakunaymatata|animeflv|filemoon|streamtape|dood|vidsrc|watchsb|shadowlands/i },
  { name: 'VidSrc',      type: 'frame', media: /\.m3u8|\.mp4|\.mpd|googlevideo|hakunaymatata|filemoon|streamtape|dood|vidsrc|cloudnestra|shadowlands/i },
  { name: '2Embed',      type: 'frame', media: /\.m3u8|\.mp4|\.mpd|googlevideo|hakunaymatata|filemoon|streamtape|dood|2embed|shadowlands/i },
  { name: 'SuperEmbed',  type: 'frame', media: /\.m3u8|\.mp4|\.mpd|googlevideo|hakunaymatata|filemoon|streamtape|dood|multiembed|shadowlands/i },
  { name: 'VSEmbed',     type: 'frame', media: /\.m3u8|\.mp4|\.mpd|googlevideo|hakunaymatata|filemoon|streamtape|dood|vsembed|shadowlands/i },
];

/** Pola URL yang DIPAKAI sebagai video (dan urutan prioritasnya). */
const VIDEO_PATTERNS = [
  /\.m3u8(\?|$)/i,                       // HLS — paling disukai ExoPlayer
  /\.mpd(\?|$)/i,                        // DASH
  /\/mp\/[^?]+\.(mp4|mkv)(\?|$)/i,       // perantara MovieZone
  /\/sacdn\//i,                          // CloudFront MovieZone
  /\.(mp4|mkv|webm)(\?|$)/i,             // mp4 langsung
];

/** URL ini BUKAN video meski cocok pola (subtitle, gambar, dsb.). */
const NOT_VIDEO = /\.(srt|vtt|ass|ssa|jpg|jpeg|png|gif|webp|css|json|svg|woff2?|ttf)(\?|$)|subtitle|\/sub\//i;

/** Pilih URL video terbaik dari beberapa kandidat (HLS > DASH > mp4). */
function pickVideo(urls) {
  for (const re of VIDEO_PATTERNS) {
    const hit = urls.find((u) => re.test(u) && !NOT_VIDEO.test(u) && !BLOCK.test(u));
    if (hit) return hit;
  }
  return null;
}
function engineUrl(engine, tmdb, type, season, episode) {
  const tv = type === 'tv' && season > 0;
  switch (engine.name) {
    case 'VidLink':
      return tv ? `https://vidlink.pro/tv/${tmdb}/${season}/${episode}` : `https://vidlink.pro/movie/${tmdb}`;
    case 'VidSrcWiki':
      return tv ? `https://vidsrc.wiki/embed/tv/${tmdb}/${season}/${episode}` : `https://vidsrc.wiki/embed/movie/${tmdb}`;
    case 'VidSrc':
      return tv ? `https://vidsrc.to/embed/tv/${tmdb}/${season}/${episode}` : `https://vidsrc.to/embed/movie/${tmdb}`;
    case '2Embed':
      return tv ? `https://www.2embed.cc/embedtv/${tmdb}&s=${season}&e=${episode}` : `https://www.2embed.cc/embed/${tmdb}`;
    case 'SuperEmbed':
      return tv
        ? `https://multiembed.mov/?video_id=${tmdb}&tmdb=1&s=${season}&e=${episode}`
        : `https://multiembed.mov/?video_id=${tmdb}&tmdb=1`;
    case 'VSEmbed':
      // VSEmbed butuh id IMDb; kalau tidak ada, lompati (ditangani pemanggil).
      return null;
    default:
      return null;
  }
}

/* ------------------------------------------------------- penyaring iklan ---- */

/**
 * Pola URL yang DIBLOKIR (iklan, pelacak, telemetri).
 * Semua request ini diputus sebelum keluar, sehingga skrip iklan tidak
 * pernah jalan — tidak ada popup, tidak ada bandwidth terbuang.
 */
const BLOCK = new RegExp([
  'llvpn', 'popads', 'popcash', 'adcash', 'adsterra', 'propellerads', 'propeller',
  'mercury', 'venus', 'doubleclick', 'googlesyndication', 'googleadservices',
  'googletagmanager', 'google-analytics', 'googletagservices',
  'yandex\\.(ru|net|com)', 'mc\\.yandex', 'clarity\\.ms', 'c\\.clarity',
  'adservice', 'onclickads', 'onclick', 'adform', 'adnxs', 'adsco', 'ad-delivery',
  'trafficjunky', 'exoclick', 'juicyads', 'clickadu', 'hilltopads', 'adsterra',
  'profitableratecpm', 'mgid', 'taboola', 'outbrain', 'revcontent',
  'histats', 'statcounter', 'quantserve', 'scorecardresearch', 'crazyegg',
  'hotjar', 'mixpanel', 'segment\\.io', 'amplitude', 'sentry',
  '\\/ads?\\/', '\\/advert', '\\/popunder', '\\/pop\\.js', '\\/tag\\.min\\.js',
  'facebook\\.net', 'fbcdn.*\\/tr', 'criteo', 'pubmatic', 'rubiconproject',
  'openx', 'smartadserver', 'teads', 'sharethrough',
  'cloudflareinsights', 'beacon\\.min\\.js',
  'youtube\\.com\\/api\\/stats', 'imasdk', 'jwp?ads', 'jwplayer.*ad',
].join('|'), 'i');

/* ------------------------------------------------------------------ cache ---- */

const CACHE_FILE = process.env.EX_CACHE_FILE
  || path.join(process.env.LUNAR_DATA_DIR || __dirname, 'extract-cache.json');

let store = {};
try { store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (_) { store = {}; }

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store));
  } catch (_) { /* cache sekunder — gagal simpan tidak fatal */ }
}

function key(tmdb, type, season, episode) {
  return `${type || 'movie'}:${tmdb}:${season || 0}:${episode || 0}`;
}

function getCached(tmdb, type, season, episode) {
  const e = store[key(tmdb, type, season, episode)];
  if (!e || !e.exp || e.exp < Date.now()) return null;
  return e;
}

function putCache(tmdb, type, season, episode, data) {
  store[key(tmdb, type, season, episode)] = {
    ...data, savedAt: Date.now(), exp: Date.now() + TTL * 1000,
  };
  saveCache();
}

/* -------------------------------------------------------- chromium finder ---- */

function findChrome() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);

  // cache Playwright/Puppeteer dulu — installer distro sering hanya memberi
  // pembungkus snap yang gagal jalan di server.
  const home = process.env.HOME || '/root';
  for (const base of [
    path.join(home, '.cache', 'ms-playwright'),
    path.join(home, '.cache', 'puppeteer'),
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
    } catch (_) { /* tidak ada */ }
  }

  for (const n of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome', 'headless_shell']) {
    cands.push(n);
  }

  for (const c of cands) {
    try {
      if (c.includes('/')) {
        if (fs.existsSync(c)) return c;
      } else {
        const r = spawnSync('which', [c], { encoding: 'utf8' });
        if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
      }
    } catch (_) { /* lanjut */ }
  }
  return null;
}

let chromeCache = null;
function chromePath() {
  if (chromeCache === null) chromeCache = findChrome() || '';
  return chromeCache || null;
}

function available() { return Boolean(chromePath()); }

/* --------------------------------------------------------- HTTP pembantu ---- */

function getJson(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; if (d.length > 8e6) r.destroy(); });
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/* --------------------------------------------------------- intip 1 situs ---- */

/**
 * Buka satu halaman pemutar secara headless, blokir iklan, dan kembalikan
 * URL video pertama yang cocok (beserta header yang dipakai pemutar).
 */
async function sniff(engine, tmdb, type, season, episode, chrome) {
  const url = engineUrl(engine, tmdb, type, season, episode);
  if (!url) return null;

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunar-ex-'));
  const port = 9500 + Math.floor(Math.random() * 400);

  const child = spawn(chrome, [
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
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '--user-agent=Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString().slice(0, 300); });

  const cleanup = () => {
    try { child.kill('SIGKILL'); } catch (_) {}
    setTimeout(() => { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {} }, 10_000);
  };

  try {
    // Tunggu CDP siap. Sebagian build headless menolak /json/version sampai
    // ada tab; jadi kedua endpoint dicoba, dan kegagalan /json/version
    // tidak dianggap fatal selama /json/list bisa dihubungi.
    let ok = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      const v = await getJson(`http://127.0.0.1:${port}/json/version`).catch(() => null);
      const l = await getJson(`http://127.0.0.1:${port}/json/list`).catch(() => null);
      if (l && Array.isArray(l)) { ok = { ver: v, list: l }; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!ok) { cleanup(); throw new Error('chrome gagal dibuka' + (stderr ? ': ' + stderr.slice(-150) : '')); }

    let target = (ok.list || []).find((t) => t && t.webSocketDebuggerUrl && t.type === 'page');
    if (!target) {
      try { target = await getJson(`http://127.0.0.1:${port}/json/new?about:blank`); } catch (_) {
        target = (ok.list || []).find((t) => t && t.webSocketDebuggerUrl);
      }
    }
    if (!target || !target.webSocketDebuggerUrl) { cleanup(); throw new Error('tab CDP tidak tersedia'); }

    const hit = await new Promise((resolve) => {
      let WS = globalThis.WebSocket;
      if (!WS) { try { WS = require('ws'); } catch (_) { WS = null; } }
      if (!WS) { resolve(null); return; }

      const ws = new WS(target.webSocketDebuggerUrl);
      let settled = false;
      let found = null;
      const candidates = [];       // semua URL video yang pernah terlihat
      const candidateSet = new Set();
      let graceTimer = null;
      let id = 0;

      const done = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        resolve(v);
      };
      const listen = (ev, fn) => (typeof ws.addEventListener === 'function'
        ? ws.addEventListener(ev, (e) => fn(e.data !== undefined ? e.data : e))
        : ws.on(ev, fn));
      const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));
      const timer = setTimeout(() => done(found), NAV_TIMEOUT);

      /** Simpan kandidat; mulai hitungan tunggu setelah kandidat pertama. */
      const consider = (u, headers) => {
        if (candidateSet.has(u)) return;
        candidateSet.add(u);
        candidates.push({ url: u, headers: headers || {} });
        if (!found) {
          found = { url: u, headers: headers || {}, engine: engine.name };
        }
        if (!graceTimer) {
          // beri waktu agar m3u8/DASH (biasanya muncul belakangan) ikut tertangkap
          graceTimer = setTimeout(() => {
            const best = pickVideo(candidates.map((c) => c.url));
            if (best) {
              const c = candidates.find((x) => x.url === best);
              done({ url: best, headers: c ? c.headers : {}, engine: engine.name });
            } else {
              done(found);
            }
          }, SETTLE);
        }
      };

      listen('open', () => {
        // Tanpa Fetch.enable: pemblokiran iklan dilakukan lewat Network.setBlockedURLs
        // (lebih ringan, tidak menahan tiap permintaan).
        send('Network.enable', {});
        send('Page.enable', {});
        send('Network.setBlockedURLs', { urls: BLOCK_SOURCE });
        send('Page.navigate', { url });
      });

      listen('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        const m = msg.method;

        if (m === 'Network.requestWillBeSent') {
          const req = msg.params.request || {};
          const u = req.url || '';
          // kumpulkan SEMUA kandidat media; pemilihan terbaik dilakukan setelah jeda
          if (engine.media.test(u) && !BLOCK.test(u) && !NOT_VIDEO.test(u)) consider(u, req.headers);
        }
      });

      listen('error', () => done(found));
      listen('close', () => done(found));
    });

    cleanup();
    return hit;
  } catch (e) {
    cleanup();
    throw e;
  }
}

/* Daftar pola blokir dalam bentuk array (untuk Network.setBlockedURLs). */
const BLOCK_SOURCE = [
  '*.llvpn.com/*', '*popads*', '*popcash*', '*adcash*', '*adsterra*', '*propeller*',
  '*doubleclick.net/*', '*googlesyndication*', '*googleadservices*', '*googletagmanager*',
  '*google-analytics*', '*yandex.ru/*', '*mc.yandex*', '*clarity.ms/*',
  '*adnxs.com/*', '*criteo*', '*taboola*', '*outbrain*', '*mgid*',
  '*histats*', '*quantserve*', '*scorecardresearch*', '*crazyegg*', '*hotjar*',
  '*cloudflareinsights*', '*beacon.min.js*', '*imasdk*', '*exoclick*', '*juicyads*',
];

/* ---------------------------------------------------------------- publik ---- */

/**
 * Cari URL video untuk film/episode.
 *
 * @param {string|number} tmdb
 * @param {string} type       'movie' | 'tv'
 * @param {number} season
 * @param {number} episode
 * @param {object} opts       { force, engines } — `engines` untuk membatasi pemutar
 * @returns {Promise<{url, headers, engine, cached?}>}
 */
async function extract(tmdb, type = 'movie', season = 0, episode = 0, opts = {}) {
  const cached = getCached(tmdb, type, season, episode);
  if (cached && !opts.force) return { ...cached, cached: true };

  const chrome = chromePath();
  if (!chrome) throw new Error('chromium tidak ditemukan (set CHROME_PATH)');

  const list = (opts.engines && opts.engines.length)
    ? ENGINES.filter((e) => opts.engines.includes(e.name))
    : ENGINES;

  const errors = [];
  for (const engine of list) {
    if (engine.name === 'VSEmbed') continue; // butuh id IMDb, ditangani terpisah
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const hit = await sniff(engine, tmdb, type, season, episode, chrome);
        if (hit && hit.url) {
          const data = {
            url: hit.url, headers: hit.headers || {}, engine: hit.engine,
            tmdb: String(tmdb), type, season, episode,
          };
          putCache(tmdb, type, season, episode, data);
          return { ...data, cached: false };
        }
        errors.push(`${engine.name}: tidak ada URL video`);
      } catch (e) {
        errors.push(`${engine.name}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw new Error('semua pemutar gagal — ' + errors.join(' | '));
}

/** Statistik untuk /health. */
function stats() {
  const keys = Object.keys(store);
  let valid = 0;
  const now = Date.now();
  for (const k of keys) if (store[k].exp > now) valid++;
  return {
    entries: keys.length, valid, file: CACHE_FILE,
    chrome: chromePath() || null, engines: ENGINES.map((e) => e.name),
  };
}

module.exports = { extract, getCached, putCache, available, stats, chromePath, ENGINES, CACHE_FILE };
