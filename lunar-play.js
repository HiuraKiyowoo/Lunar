/**
 * lunar-play.js — pengambil URL video memakai Playwright (Chromium sungguhan)
 * dijalankan DI SERVER, hasilnya dikirim ke APK untuk diputar ExoPlayer NATIVE.
 *
 * ---------------------------------------------------------------------------
 * KENAPA PLAYWRIGHT, BUKAN CDP MANUAL
 * ---------------------------------------------------------------------------
 * Halaman pemutar (vidlink.pro dll.) memakai WebAssembly untuk mendekripsi
 * jawaban API-nya. CDP manual kami berhasil membuka halaman tetapi player
 * berhenti di "FETCHING DATA" karena WebAssembly butuh lingkungan penuh.
 * Playwright + Chromium lengkap terbukti melewati tahap itu dalam ~2 detik
 * (diuji di VPS: URL video tertangkap, `<video>.currentSrc` terisi).
 *
 * ---------------------------------------------------------------------------
 * KENAPA URL PERANTARA `noon` YANG DIKIRIM (bukan CDN langsung)
 * ---------------------------------------------------------------------------
 * CDN `bcdn*.hakunaymatata.com` memblokir IP datacenter: dari VPS semua
 * kombinasi header menghasilkan 428/429/403, sedangkan permintaan yang sama
 * pernah 206 dari IP non-datacenter. Karena itu server TIDAK mengunduh video;
 * server hanya MEMBERI TAHU alamatnya, dan perangkat (IP residensial) yang
 * mengambil langsung. Ini juga sebabnya iklan tidak pernah muncul: halaman
 * pemutar tidak pernah dirender ke layar — hanya lalu lintas jaringannya dibaca.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------- setelan ----- */

const NAV_TIMEOUT = Number(process.env.PW_NAV_TIMEOUT || 60_000);
const WAIT_MEDIA = Number(process.env.PW_WAIT_MEDIA || 30_000);
const TTL = Number(process.env.PW_TTL || 3_000);          // umur cache (detik)
const LAUNCH_TIMEOUT = Number(process.env.PW_LAUNCH_TIMEOUT || 30_000);

const UA = process.env.PW_UA
  || 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

/** Pemutar cadangan, berurutan. */
const ENGINES = [
  { name: 'VidLink',    url: (id, tv, s, e) => tv ? `https://vidlink.pro/tv/${id}/${s}/${e}` : `https://vidlink.pro/movie/${id}` },
  { name: 'VidSrcWiki', url: (id, tv, s, e) => tv ? `https://vidsrc.wiki/embed/tv/${id}/${s}/${e}` : `https://vidsrc.wiki/embed/movie/${id}` },
  { name: 'VidSrc',     url: (id, tv, s, e) => tv ? `https://vidsrc.to/embed/tv/${id}/${s}/${e}` : `https://vidsrc.to/embed/movie/${id}` },
  { name: '2Embed',     url: (id, tv, s, e) => tv ? `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` : `https://www.2embed.cc/embed/${id}` },
  { name: 'SuperEmbed', url: (id, tv, s, e) => tv ? `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` : `https://multiembed.mov/?video_id=${id}&tmdb=1` },
];

/* ------------------------------------------------ pola video & iklan ------- */

/** Urutan prioritas pemilihan URL video. */
const VIDEO_PATTERNS = [
  /\.m3u8(\?|$)/i,
  /\.mpd(\?|$)/i,
  /\/mp\/[^?]+\.(mp4|mkv)(\?|$)/i,
  /\/sacdn\//i,
  /\.(mp4|mkv|webm)(\?|$)/i,
];

/** Jelas bukan video. */
const NOT_VIDEO = /\.(srt|vtt|ass|ssa|jpg|jpeg|png|gif|webp|css|js|json|svg|woff2?|ttf)(\?|$)|subtitle|\/sub\//i;

/** Domain iklan/pelacak — permintaannya dibatalkan agar tidak ikut dimuat. */
const AD_HOSTS = new RegExp([
  'llvpn', 'popads', 'popcash', 'adcash', 'adsterra', 'propeller',
  'mercury', 'venus', 'doubleclick', 'googlesyndication', 'googleadservices',
  'googletagmanager', 'google-analytics', 'yandex', 'clarity\\.ms',
  'adnxs', 'criteo', 'taboola', 'outbrain', 'mgid', 'exoclick', 'juicyads',
  'histats', 'quantserve', 'scorecardresearch', 'crazyegg', 'hotjar',
  'cloudflareinsights', 'imasdk', 'onclickads', 'clickadu', 'hilltopads',
].join('|'), 'i');

/** Pilih video terbaik dari kandidat (HLS > DASH > mp4). */
function pickVideo(urls) {
  for (const re of VIDEO_PATTERNS) {
    const hit = urls.find((u) => re.test(u) && !NOT_VIDEO.test(u) && !AD_HOSTS.test(u));
    if (hit) return hit;
  }
  return null;
}

/* --------------------------------------------------------------- cache ----- */

const CACHE_FILE = process.env.PW_CACHE_FILE
  || path.join(process.env.LUNAR_DATA_DIR || __dirname, 'play-cache.json');

let store = {};
try { store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (_) { store = {}; }

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store));
  } catch (_) { /* cache sekunder — gagal simpan tidak fatal */ }
}

const ck = (id, type, s, e) => `${type}:${id}:${s || 0}:${e || 0}`;

function getCached(id, type, s, e) {
  const it = store[ck(id, type, s, e)];
  if (!it || !it.exp || it.exp < Date.now()) return null;
  return it;
}

function putCached(id, type, s, e, data) {
  store[ck(id, type, s, e)] = { ...data, savedAt: Date.now(), exp: Date.now() + TTL * 1000 };
  saveCache();
}

/* ------------------------------------------------------------- playwright -- */

let pwCache;
function playwright() {
  if (pwCache !== undefined) return pwCache;
  for (const mod of ['playwright', 'playwright-core', 'playwright-chromium']) {
    try { pwCache = require(mod); return pwCache; } catch (_) { /* coba berikutnya */ }
  }
  // fallback: pakai salinan di cache npx (kalau proyek tidak punya node_modules)
  try {
    const home = process.env.HOME || '/root';
    const base = path.join(home, '.npm', '_npx');
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'node_modules', 'playwright-core');
      if (fs.existsSync(p)) { pwCache = require(p); return pwCache; }
    }
  } catch (_) { /* tidak ada */ }
  pwCache = null;
  return pwCache;
}

function available() { return Boolean(playwright()); }

/** Cari chromium dari cache Playwright kalau instalasi tidak menemukannya sendiri. */
function chromiumPath() {
  const home = process.env.HOME || '/root';
  const bases = [
    path.join(home, '.cache', 'ms-playwright'),
    '/ms-playwright',
  ];
  const out = [];
  for (const base of bases) {
    try {
      for (const d of fs.readdirSync(base).sort().reverse()) {
        if (!/^chromium/.test(d)) continue;
        for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-linux/headless_shell']) {
          const p = path.join(base, d, rel);
          if (fs.existsSync(p)) out.push(p);
        }
      }
    } catch (_) { /* lanjut */ }
  }
  // utamakan chrome penuh (WASM pemutar butuh lebih dari headless_shell)
  return out.find((p) => /chrome-linux\/chrome$|chrome-linux64\/chrome$/.test(p)) || out[0] || null;
}

/* --------------------------------------------------------------- intip ----- */

/**
 * Buka satu halaman pemutar, blokir iklan, dan kembalikan URL video.
 * @returns {Promise<{url, headers, engine, page?}>}
 */
async function sniff(engine, tmdb, type, season, episode, browser) {
  const target = engine.url(tmdb, type === 'tv', season || 1, episode || 1);
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  const media = [];
  const mediaSet = new Set();
  const adBlocked = [];

  // buang iklan sebelum keluar — inilah yang membuat stream "tanpa iklan"
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (AD_HOSTS.test(u) && !/\.m3u8|\.mp4|\.mpd|\/mp\/|sacdn/i.test(u)) {
      adBlocked.push(u);
      return route.abort().catch(() => {});
    }
    return route.continue().catch(() => {});
  }).catch(() => {});

  page.on('request', (r) => {
    const u = r.url();
    if (!/\.m3u8|\.mp4|\.mpd|\/mp\/|sacdn|hakunaymatata/i.test(u)) return;
    if (NOT_VIDEO.test(u) || AD_HOSTS.test(u)) return;
    if (mediaSet.has(u)) return;
    mediaSet.add(u);
    media.push({ url: u, headers: r.headers() || {} });
  });

  let hit = null;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    // tunggu sampai kandidat video muncul (maks WAIT_MEDIA)
    const t0 = Date.now();
    while (Date.now() - t0 < WAIT_MEDIA) {
      if (media.length) {
        // beri jeda singkat supaya m3u8 (bila ada) ikut tertangkap
        await page.waitForTimeout(1_200);
        break;
      }
      await page.waitForTimeout(500);
    }

    // terakhir: periksa elemen <video> — kadang URL hanya ada di situ
    if (!media.length) {
      const cur = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return v.currentSrc || v.src || null;
      }).catch(() => null);
      if (cur) media.push({ url: cur, headers: {} });
    }

    const best = pickVideo(media.map((m) => m.url));
    if (best) {
      const m = media.find((x) => x.url === best);
      hit = { url: best, headers: m ? m.headers : {}, engine: engine.name, adBlocked: adBlocked.length };
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  return hit;
}

/* --------------------------------------------------------------- publik ---- */

/**
 * Cari URL video untuk film/episode.
 *
 * @param {string|number} tmdb
 * @param {string} type  'movie' | 'tv'
 * @param {number} season
 * @param {number} episode
 * @param {object} opts  { force, engines }
 */
async function extract(tmdb, type = 'movie', season = 0, episode = 0, opts = {}) {
  const cached = getCached(tmdb, type, season, episode);
  if (cached && !opts.force) return { ...cached, cached: true };

  const pw = playwright();
  if (!pw) throw new Error('playwright tidak terpasang (npm i playwright)');

  const list = (opts.engines && opts.engines.length)
    ? ENGINES.filter((e) => opts.engines.includes(e.name))
    : ENGINES;

  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
    ],
    timeout: LAUNCH_TIMEOUT,
  };
  const cp = chromiumPath();
  if (cp) launchOpts.executablePath = cp;

  const browser = await pw.chromium.launch(launchOpts);
  const errors = [];
  try {
    for (const engine of list) {
      try {
        const hit = await sniff(engine, tmdb, type, season, episode, browser);
        if (hit && hit.url) {
          const data = {
            url: hit.url, headers: hit.headers || {}, engine: hit.engine,
            adBlocked: hit.adBlocked || 0,
            tmdb: String(tmdb), type, season: season || 0, episode: episode || 0,
          };
          putCached(tmdb, type, season, episode, data);
          return { ...data, cached: false };
        }
        errors.push(`${engine.name}: tidak ada URL video`);
      } catch (e) {
        errors.push(`${engine.name}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  throw new Error('semua pemutar gagal — ' + errors.join(' | '));
}

/** Statistik untuk /health. */
function stats() {
  const keys = Object.keys(store);
  const now = Date.now();
  let valid = 0;
  for (const k of keys) if (store[k].exp > now) valid++;
  return {
    ready: available(), entries: keys.length, valid,
    file: CACHE_FILE, chrome: chromiumPath(), engines: ENGINES.map((e) => e.name),
  };
}

module.exports = { extract, getCached, putCached, available, stats, chromiumPath, ENGINES, CACHE_FILE };
