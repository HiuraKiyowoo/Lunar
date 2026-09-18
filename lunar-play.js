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

const NAV_TIMEOUT = Number(process.env.PW_NAV_TIMEOUT || 75_000);
const WAIT_MEDIA = Number(process.env.PW_WAIT_MEDIA || 75_000);
const TTL = Number(process.env.PW_TTL || 3_000);          // umur cache (detik)
const LAUNCH_TIMEOUT = Number(process.env.PW_LAUNCH_TIMEOUT || 30_000);

/**
 * Berapa lama menunggu SETELAH kandidat pertama muncul, untuk memberi
 * kesempatan play-list HLS ikut tertangkap.
 *
 * Halaman pemutar biasanya meminta berkas .mp4 dulu (pratinjau) baru
 * play-list HLS. Menunggu terlalu lama hanya membuang waktu; menunggu
 * terlalu singkat membuat kita mengambil .mp4 bertanda tangan yang cepat
 * tua. Nilai ini diturunkan dari 1200 ms — permintaan HLS menyusul dalam
 * beberapa ratus milidetik pada pengujian.
 */
const SETTLE_MS = Number(process.env.PW_SETTLE_MS || 600);

/**
 * Berapa lama tidak ada lalu lintas media baru sebelum dianggap selesai.
 * Begitu halaman tenang, menunggu sampai batas penuh hanya membuang waktu.
 */
const IDLE_MS = Number(process.env.PW_IDLE_MS || 4_000);

const UA = process.env.PW_UA
  || 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';

/** Pemutar cadangan, berurutan. */
const ENGINES = [
  // VidSrcWiki DIUTAMAKAN: pemutarnya (cinesrc.st) memakai HLS — tanpa tanda
  // tangan, tanpa Cloudflare, segmennya di nebula.bright67.online yang tidak
  // memblokir IP datacenter. Diuji: 200 video/mp4 dari VPS.
  { name: 'VidSrcWiki', url: (id, tv, s, e) => tv ? `https://vidsrc.wiki/embed/tv/${id}/${s}/${e}` : `https://vidsrc.wiki/embed/movie/${id}` },
  { name: 'VidLink',    url: (id, tv, s, e) => tv ? `https://vidlink.pro/tv/${id}/${s}/${e}` : `https://vidlink.pro/movie/${id}` },
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

/** Apakah URL ini HLS? (play-list m3u8 atau endpoint playlist cinesrc) */
function isHlsUrl(u) {
  return /\.m3u8(\?|$)/i.test(u) || /\/api\/playlist\//i.test(u);
}

/**
 * Pilih video terbaik dari kandidat (HLS > DASH > mp4).
 *
 * PENTING — master vs anak:
 * Halaman cinesrc meminta BEBERAPA play-list: satu master yang memuat daftar
 * varian (1080p, 720p) dan beberapa anak yang hanya memuat segmen satu
 * varian. Kalau yang diambil anak, pemutar kehilangan pilihan mutu — dan
 * lebih buruk lagi, anak hanya memuat sebagian film.
 *
 * Master tidak bisa dikenali dari bentuk alamatnya (keduanya sama-sama
 * /api/playlist/<hash>), jadi penilaian dilakukan dari isi respons oleh
 * peringkatPlaylist() di bawah; di sini hanya urutan kemunculan yang dipakai
 * sebagai cadangan.
 */
function pickVideo(urls) {
  for (const re of VIDEO_PATTERNS) {
    const hit = urls.find((u) => re.test(u) && !NOT_VIDEO.test(u) && !AD_HOSTS.test(u));
    if (hit) return hit;
  }
  return null;
}

/**
 * Beri nilai sebuah play-list berdasarkan isinya. Yang lebih tinggi nilainya
 * yang dipakai.
 *
 *   +1000  memuat #EXT-X-STREAM-INF  → master (punya daftar varian)
 *   +500   memuat #EXT-X-MAP         → anak yang sah (punya inisialisasi)
 *   +200   memuat #EXT-X-ENDLIST     → daftar lengkap, bukan potongan
 *   +1 per baris #EXTINF             → makin banyak segmen makin baik
 *   -1     bukan play-list
 */
async function peringkatPlaylist(url, referer, cookie) {
  try {
    const r = await fetch(url, {
      headers: {
        ...(referer ? { Referer: referer } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        'User-Agent': UA,
      },
    });
    if (!r.ok) return -1;
    const t = await r.text();
    if (!t.includes('#EXTM3U')) return -1;
    let skor = 0;
    if (t.includes('#EXT-X-STREAM-INF')) skor += 1000;
    if (t.includes('#EXT-X-MAP')) skor += 500;
    if (t.includes('#EXT-X-ENDLIST')) skor += 200;
    skor += (t.match(/#EXTINF/g) || []).length;
    return skor;
  } catch (_) {
    return -1;
  }
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

// Kunci cache menyertakan nama pemutar: hasil VidLink (.mp4 bertanda tangan)
// tidak boleh menutupi hasil VidSrcWiki (HLS). Keduanya punya kelebihan
// berbeda dan harus bisa dipilih terpisah lewat ?only=.
const ck = (id, type, s, e, engine) => `${type}:${id}:${s || 0}:${e || 0}:${engine || '*'}`;

function getCached(id, type, s, e, engine) {
  // utamakan entri pemutar yang diminta; kalau tidak ada, pakai entri mana pun
  // yang masih berlaku (agar permintaan tanpa `only` tetap cepat).
  const k = ck(id, type, s, e, engine);
  let it = store[k];
  if (!it && engine) {
    for (const [key, val] of Object.entries(store)) {
      if (key.startsWith(`${type}:${id}:${s || 0}:${e || 0}:`)) { it = val; break; }
    }
  }
  if (!it || !it.exp || it.exp < Date.now()) return null;
  // hasil HLS selalu lebih diutamakan daripada mp4 bertanda tangan
  return it;
}

function putCached(id, type, s, e, data, engine) {
  store[ck(id, type, s, e, engine)] = { ...data, savedAt: Date.now(), exp: Date.now() + TTL * 1000 };
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

    // Tunggu sampai kandidat video muncul (maks WAIT_MEDIA).
    //
    // waitForTimeout melempar bila tab/halaman sudah ditutup (redirect iklan,
    // atau Chromium mati kehabisan memori). Itu BUKAN kegagalan pemutar —
    // kalau sudah ada kandidat, pakai saja; kalau belum, pemutar ini dianggap
    // tidak memberi hasil dan pemutar berikutnya dicoba.
    const t0 = Date.now();
    const stillAlive = () => !page.isClosed();
    let lastCount = 0;
    let lastNewAt = Date.now();
    let lastProbe = 0;
    let domCur = null;

    while (Date.now() - t0 < WAIT_MEDIA) {
      // Berhenti lebih awal begitu play-list HLS tertangkap — itu hasil
      // terbaik yang mungkin didapat, tak ada gunanya menunggu sisanya.
      if (media.some((m) => isHlsUrl(m.url))) {
        await page.waitForTimeout(SETTLE_MS).catch(() => {});
        break;
      }

      if (media.length) {
        // Ada kandidat. Beri jeda singkat supaya play-list HLS (bila ada)
        // ikut tertangkap, lalu selesai. Menunggu lebih lama tidak menambah
        // mutu hasil — pada pengujian play-list sudah muncul di detik 22
        // sementara batas penuh 75 detik hanya membuang waktu.
        await page.waitForTimeout(SETTLE_MS).catch(() => {});
        break;
      }

      if (!stillAlive()) break;

      // Tiap ~2 detik, periksa elemen <video>. Sebagian halaman hanya
      // menaruh alamat di situ setelah beberapa saat, dan menunggu buta
      // sampai batas penuh memboroskan puluhan detik.
      const now = Date.now();
      if (now - lastProbe > 2_000) {
        lastProbe = now;
        domCur = await page.evaluate(() => {
          const v = document.querySelector('video');
          if (!v) return null;
          return v.currentSrc || v.src || null;
        }).catch(() => null);
        if (domCur && /\.m3u8|\.mp4|\/mp\/|sacdn/i.test(domCur)) {
          media.push({ url: domCur, headers: {} });
          await page.waitForTimeout(SETTLE_MS).catch(() => {});
          break;
        }
      }

      // Kalau sudah ada lalu lintas media tapi tidak ada yang baru selama
      // beberapa detik, halaman sudah tenang — tidak perlu menunggu penuh.
      if (media.length !== lastCount) {
        lastCount = media.length;
        lastNewAt = now;
      } else if (media.length > 0 && now - lastNewAt > IDLE_MS) {
        break;
      }

      const waited = await page.waitForTimeout(500).then(() => true).catch(() => false);
      if (!waited) break;   // halaman mati → berhenti menunggu
    }

    // terakhir: periksa elemen <video> — kadang URL hanya ada di situ
    if (!media.length && domCur) media.push({ url: domCur, headers: {} });
    if (!media.length) {
      const cur = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return v.currentSrc || v.src || null;
      }).catch(() => null);
      if (cur) media.push({ url: cur, headers: {} });
    }

    // Cookie sesi dipakai proxy HLS: sub-playlist sumber hanya dijawab bila
    // permintaannya membawa sesi yang sama dengan yang dipakai pemutar.
    let cookie = '';
    try {
      const cs = await ctx.cookies();
      cookie = cs.map((c) => `${c.name}=${c.value}`).join('; ');
    } catch (_) { /* cookie opsional */ }

    // Di antara beberapa play-list, ambil yang paling lengkap menurut isinya.
    // Ini WAJIB: halaman meminta master (berisi daftar varian) dan anak-anak
    // (berisi segmen satu varian) pada alamat yang bentuknya sama persis.
    const kandidat = media.map((m) => m.url).filter((u) => isHlsUrl(u));
    if (kandidat.length) {
      const nilai = [];
      for (const u of kandidat) {
        const m = media.find((x) => x.url === u);
        nilai.push({
          url: u,
          skor: await peringkatPlaylist(u, m && m.headers ? m.headers.referer : '', cookie),
        });
      }
      nilai.sort((a, b) => b.skor - a.skor);
      if (nilai[0].skor > 0) {
        const m = media.find((x) => x.url === nilai[0].url);
        hit = {
          url: nilai[0].url,
          headers: m ? m.headers : {},
          engine: engine.name,
          adBlocked: adBlocked.length,
          cookie,
        };
      }
    }

    if (!hit) {
      const best = pickVideo(media.map((m) => m.url));
      if (best) {
        const m = media.find((x) => x.url === best);
        hit = {
          url: best,
          headers: m ? m.headers : {},
          engine: engine.name,
          adBlocked: adBlocked.length,
          cookie,
        };
      }
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
  const only = (opts.engines && opts.engines[0]) || null;
  const cached = getCached(tmdb, type, season, episode, only);
  if (cached && !opts.force) return { ...cached, cached: true };

  const pw = playwright();
  if (!pw) throw new Error('playwright tidak terpasang (npm i playwright)');

  const list = (opts.engines && opts.engines.length)
    ? ENGINES.filter((e) => opts.engines.includes(e.name))
    : ENGINES;

  const browser = await getBrowser(pw);
  const errors = [];
  const got = [];           // semua hasil yang berhasil, untuk dipilih terbaik
  try {
    for (const engine of list) {
      try {
        const hit = await sniff(engine, tmdb, type, season, episode, browser);
        if (hit && hit.url) {
          const data = {
            url: hit.url, headers: hit.headers || {}, engine: hit.engine,
            cookie: hit.cookie || '',
            adBlocked: hit.adBlocked || 0,
            tmdb: String(tmdb), type, season: season || 0, episode: episode || 0,
          };
          putCached(tmdb, type, season, episode, data, hit.engine);

          // HLS menang langsung: tidak ada tanda tangan yang bisa kedaluwarsa
          // dan segmennya tidak diblokir. Tidak perlu mencoba pemutar lain.
          if (isHlsUrl(hit.url)) return { ...data, cached: false };
          got.push(data);
        } else {
          errors.push(`${engine.name}: tidak ada URL video`);
        }
      } catch (e) {
        errors.push(`${engine.name}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    // tidak ada HLS, tapi ada hasil lain (mp4) → pakai yang pertama
    if (got.length) return { ...got[0], cached: false };
  } finally {
    // Peramban TIDAK ditutup di sini — ia dipakai ulang oleh permintaan
    // berikutnya (lihat getBrowser). Membuka Chromium baru tiap film
    // memakan 3-8 detik; memakai ulang hanya perlu satu tab baru.
    for (const v of got) { /* hasil disimpan di cache, aman */ }
  }
  throw new Error('semua pemutar gagal — ' + errors.join(' | '));
}

/* ------------------------------------------------ peramban dipakai ulang --- */

/**
 * Satu Chromium untuk SEMUA permintaan.
 *
 * Sebelumnya tiap permintaan membuka peramban baru lalu menutupnya lagi.
 * Membuka Chromium memakan 3-8 detik dan itu terjadi SETIAP kali pengguna
 * berganti film atau episode. Dengan satu peramban yang hidup terus, biaya
 * itu hanya dibayar sekali; permintaan berikutnya hanya perlu satu tab
 * (tab baru sekitar 0,3 detik).
 *
 * Peramban ditutup sendiri bila tidak dipakai selama BROWSER_IDLE_MS supaya
 * memori di VPS kecil tidak mengendap.
 */
const BROWSER_IDLE_MS = Number(process.env.PW_BROWSER_IDLE_MS || 300_000);

let browserPromise = null;
let browserRef = null;
let idleTimer = null;

function launchOpts() {
  const o = {
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
      // Pemakaian ulang peramban membuat timbunan memori lebih mungkin;
      // batasi supaya VPS tidak kehabisan.
      '--js-flags=--max-old-space-size=256',
    ],
    timeout: LAUNCH_TIMEOUT,
  };
  const cp = chromiumPath();
  if (cp) o.executablePath = cp;
  return o;
}

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const b = browserRef;
    browserRef = null;
    browserPromise = null;
    if (b) b.close().catch(() => {});
  }, BROWSER_IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

async function getBrowser(pw) {
  touchIdle();
  if (browserRef && browserRef.isConnected()) return browserRef;
  if (browserPromise) return browserPromise;

  browserPromise = pw.chromium.launch(launchOpts()).then((b) => {
    browserRef = b;
    browserPromise = null;
    // Kalau peramban mati sendiri (crash), bersihkan supaya permintaan
    // berikutnya membuka yang baru alih-alih memakai yang sudah mati.
    b.on('disconnected', () => {
      if (browserRef === b) { browserRef = null; browserPromise = null; }
    });
    return b;
  }).catch((e) => {
    browserPromise = null;
    throw e;
  });
  return browserPromise;
}

/** Tutup peramban (dipakai saat mematikan server). */
async function closeBrowser() {
  if (idleTimer) clearTimeout(idleTimer);
  const b = browserRef;
  browserRef = null;
  browserPromise = null;
  if (b) await b.close().catch(() => {});
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

module.exports = { extract, getCached, putCached, available, stats, chromiumPath, closeBrowser, ENGINES, CACHE_FILE };
