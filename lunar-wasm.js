/**
 * lunar-wasm.js — jalanin WASM VidLink buat dapetin token getAdv(tmdbId).
 *
 * CARA KERJA (hasil reverse, sudah terbukti 100%):
 *  1. Sandbox browser palsu (self/window/document/navigator)
 *  2. Muat libsodium (module 73551) → pasang window.sodium
 *  3. Muat script.js (loader Emscripten) → globalThis.Dm
 *  4. Instantiate fu.wasm (Go) → Dm.run(instance)
 *  5. getAdv(id) = TOKEN  →  dipakai ke  /api/b/movie/{token}
 *
 * PENTING: window.sodium HARUS terpasang SEBELUM new Dm(),
 *          kalau tidak getAdv() balikin null.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');
const http = require('http');

const HERE = __dirname;
const CHUNKS = path.join(HERE, 'chunks');
const WASM = path.join(HERE, 'wasm');

/**
 * GET JSON/text dengan PAKSA IPv4.
 *
 * Penting: di banyak VPS, DNS vidlink.pro hanya mengembalikan AAAA (IPv6),
 * sementara IPv6 tidak jalan. `fetch()` bawaan Node (undici) akan mencoba
 * IPv6 dan gagal dengan "fetch failed". Kita pakai `family: 4` + `lookup`
 * untuk memaksa IPv4.
 */
function fetchNode(url, headers = {}, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'GET',
        headers,
        family: 4,          // ← paksa IPv4
        lookup: (host, opts, cb) => {
          require('dns').lookup(host, { ...opts, family: 4 }, cb);
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, text: data, headers: res.headers }));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout ' + timeoutMs + 'ms')));
    req.on('error', reject);
    req.end();
  });
}

let modules = {};
let reqFull = null;      // webpack require lengkap
let readyPromise = null; // inisialisasi sekali saja

/** Video palsu — codec detection butuh ini. */
function fakeVideo() {
  return {
    style: {}, setAttribute() {}, getAttribute: () => null,
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    canPlayType: () => 'probably',
    load() {}, play: () => Promise.resolve(), pause() {},
  };
}

function buildSandbox() {
  const sandbox = {
    location: {
      href: 'https://vidlink.pro/movie/550',
      origin: 'https://vidlink.pro',
      hostname: 'vidlink.pro',
      pathname: '/movie/550',
      protocol: 'https:',
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
      languages: ['en-US'],
      plugins: { namedItem: () => true },
      onLine: true,
    },
    document: {
      createElement: (t) => (t === 'video' ? fakeVideo() : {
        style: {}, appendChild() {}, setAttribute() {}, addEventListener() {},
        getContext: () => null,
      }),
      body: { appendChild() {} },
      head: { appendChild() {} },
      documentElement: {},
      addEventListener() {}, removeEventListener() {},
      cookie: '',
      referrer: '',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createTextNode: () => ({}),
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    performance: { now: () => Date.now() },
    console,
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {},
    queueMicrotask: (f) => Promise.resolve().then(f),
    process: { env: {}, nextTick: (f) => Promise.resolve().then(f), version: 'v22.0.0', platform: 'linux' },
    AbortController, Blob, FormData, Headers, Request, Response,
    TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams,
    WebAssembly,
    crypto: require('crypto').webcrypto,
    screen: { width: 1080, height: 2400, orientation: { type: 'portrait' } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.window.top = sandbox;
  sandbox.window.parent = sandbox;
  sandbox.window.frameElement = null;

  // ⚠️ PENTING: libsodium.js & chunk lain punya `module.exports` SENDIRI.
  // Kalau tidak dipalsukan, mereka menulis ke module.exports milik Node
  // dan require() mengembalikan objek KOSONG. Wajib ada.
  sandbox.module = { exports: {} };
  sandbox.exports = sandbox.module.exports;
  sandbox.require = (m) => require(m);
  sandbox.__filename = '/sandbox/chunk.js';
  sandbox.__dirname = '/sandbox';

  // fetch tidak dipakai WASM (network calls: 0), tapi disediakan biar aman
  sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => 'null', json: async () => null });
  return sandbox;
}

/** Rakit webpack loader (persis seperti di browser). */
function buildRequire(sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(
    'self.webpackChunk_N_E=[]; self.webpackChunk_N_E.push=function(c){ globalThis.__setM(c[1]); return Array.prototype.push.call(this,c); };',
    sandbox,
  );
  sandbox.__setM = (m) => Object.assign(modules, m);

  const files = fs.readdirSync(CHUNKS).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    try {
      vm.runInContext(fs.readFileSync(path.join(CHUNKS, f), 'utf8'), sandbox, { filename: f });
    } catch (e) { /* chunk sebagian memang gagal di luar konteks React */ }
  }

  const cache = {};
  const req = (id) => {
    if (!modules[id]) throw new Error('module ' + id + ' tidak ada');
    if (cache[id]) return cache[id].exports;
    const m = { exports: {} };
    cache[id] = m;
    modules[id].call(m.exports, m, m.exports, req);
    return m.exports;
  };
  // helper webpack
  req.d = (e, d) => { for (const k in d) if (!Object.prototype.hasOwnProperty.call(e, k)) Object.defineProperty(e, k, { enumerable: true, get: d[k] }); };
  req.o = (o, p) => Object.prototype.hasOwnProperty.call(o, p);
  req.n = (m) => { const g = m && m.__esModule ? () => m.default : () => m; req.d(g, { a: g }); return g; };
  req.r = (e) => Object.defineProperty(e, '__esModule', { value: true });
  req.nmd = (m) => (m.paths = [], m.children || (m.children = []), m);
  return req;
}

/** Inisialisasi WASM (sekali). */
async function init() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const sandbox = buildSandbox();
    const req = buildRequire(sandbox);
    reqFull = req;

    // libsodium DULU
    const sod = req(73551);
    const sodium = sod.default || sod;
    if (sodium.ready && typeof sodium.ready.then === 'function') await sodium.ready;
    sandbox.sodium = sodium;

    // loader Emscripten
    vm.runInContext(fs.readFileSync(path.join(WASM, 'script.js'), 'utf8'), sandbox, { filename: 'script.js' });
    const Dm = sandbox.Dm;
    if (!Dm) throw new Error('Dm tidak ada — script.js gagal');

    const e = new Dm();
    const importObject = e.importObject || {};
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(WASM, 'fu.wasm')), importObject);
    e.run(instance);
    await new Promise((r) => setTimeout(r, 1200)); // tunggu Go runtime siap

    if (typeof sandbox.getAdv !== 'function') throw new Error('getAdv tidak terpasang');

    // Env WAJIB "standard" (bukan hasil eC() yang balikin "hls") —
    // eC() hasil deteksi runtime; di server tidak ada HLS/dash native.
    const ENV = 'standard';

    // Pemanggil API — pakai fetch ASLI, key "X-Playback-Environment".
    // ie() di bundle memakai URL relatif "/api/b/movie/..." sehingga tidak
    // bisa dipakai langsung di Node; kita replikasi persis permintaannya.
    async function ie(tok, multiLang, envHeader) {
      const url = 'https://vidlink.pro/api/b/movie/' + tok + '?multiLang=' + (multiLang ? 1 : 0);
      const res = await fetchNode(url, {
        headers: {
          'X-Playback-Environment': envHeader || ENV,
          'Origin': 'https://vidlink.pro',
          'Referer': 'https://vidlink.pro/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        },
      });
      if (res.status >= 400) throw new Error('vidlink HTTP ' + res.status);
      return JSON.parse(res.text);
    }

    return { sandbox, req, env: ENV, ie };
  })();
  return readyPromise;
}

/** Token buat satu tmdb id. */
async function token(tmdbId) {
  const { sandbox } = await init();
  return sandbox.getAdv(String(tmdbId));
}

/** Ambil stream lengkap: {sourceId, stream:{qualities, captions, ...}}. */
async function stream(tmdbId, type = 'movie', season = 0, episode = 0, multiLang = 'false') {
  const { sandbox, ie, env } = await init();
  const id = type === 'tv' ? `${tmdbId}/${season}/${episode}` : String(tmdbId);
  const tok = sandbox.getAdv(id);
  if (!tok) throw new Error('token null untuk ' + id);
  const raw = await ie(tok, multiLang === 'true', env);
  return raw;
}

module.exports = { init, token, stream };
