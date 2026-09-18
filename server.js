/**
 * server.js — Lunar backend.
 *
 *  1. Proxy API MovieZone   (/api/... → moviezone.web.id)  + cache di memori
 *  2. Resolve stream VidLink (/stream?tmdb=550&type=movie) → kualitas + subtitle
 *  3. Proxy video & subtitle (/v/<id>, /s/<id>)
 *
 * Port: process.env.PORT || 3000
 * Domain: ditaruh di belakang Nginx/Cloudflare (my.zone.id)
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const wasm = require('./lunar-wasm.js');
const cdn = require('./lunar-cdn.js');
const transform = require('./lunar-vidlink-transform.js');

const PORT = process.env.PORT || 3000;
const MZ = 'https://moviezone.web.id';
/**
 * Perantara VidLink. CDN video (bcdn*.hakunaymatata.com) menolak akses
 * langsung (428/429); hanya perantara ini yang boleh mengaksesnya karena
 * ia membuat sendiri tanda tangan CloudFront (sc / cookie).
 */
const VIDEO_PROXY = process.env.VIDEO_PROXY || 'https://noon.mooncase.online/';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

/* ---------------------------------------------------------------- utils ---- */

/**
 * Ubah satu URL media (hasil transform) menjadi URL proxy server ini.
 *
 * Ada dua kemungkinan bentuk:
 *   a. URL perantara noon.mooncase.online (/mp/... atau /sacdn/...)
 *      → didaftarkan di lunar-cdn.js agar diteruskan lewat /v/<id>.
 *      Referer tetap WAJIB https://vidlink.pro/ (bukan filmboom.top).
 *   b. URL CDN langsung (bcdn*.hakunaymatata.com)
 *      → tidak bisa dipakai; ditandai agar klien tahu (dikembalikan apa adanya).
 *
 * @param {string} url      URL hasil transform
 * @param {Function} register fungsi register dari lunar-cdn.js
 */
function proxyify(url, register) {
  if (!url) return null;

  // Perantara noon.mooncase.online menolak permintaan tanpa header yang jelas:
  //   headers={}                  → 428 Forbidden (14 byte)
  //   headers={"Referer": "..."}  → lanjut (diteruskan ke CDN)
  // Jadi parameter `headers` di query WAJIB berisi Referer vidlink.
  let fixed = url;
  try {
    const u = new URL(url);
    const cur = u.searchParams.get('headers');
    const isEmpty = !cur || cur === '{}' || cur === '';
    if (isEmpty && /\/mp\//.test(u.pathname)) {
      u.searchParams.set('headers', JSON.stringify({ Referer: 'https://vidlink.pro/' }));
      fixed = u.toString();
    }
  } catch (_) { /* URL relatif / tak terduga → pakai apa adanya */ }

  return '/v/' + register(fixed, 'https://vidlink.pro/', 'https://vidlink.pro');
}

function humanSize(n) {
  if (!n || n <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const num = v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1);
  return `${num} ${units[i]}`;
}

/* ---------------------------------------------------------------- cache ---- */
const cache = new Map(); // key -> {body, type, exp}
const CACHE_MS = Number(process.env.CACHE_MS || 300_000); // 5 menit
let cacheHits = 0, cacheMiss = 0;

function cacheGet(k) {
  const v = cache.get(k);
  if (v && v.exp > Date.now()) { cacheHits++; return v; }
  if (v) cache.delete(k);
  cacheMiss++;
  return null;
}
function cacheSet(k, body, type) {
  if (cache.size > 500) cache.clear(); // sederhana, cukup
  cache.set(k, { body, type, exp: Date.now() + CACHE_MS });
}

/* ------------------------------------------------------------ helpers ---- */
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(s);
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const t = new URL(url);
    const lib = t.protocol === 'http:' ? http : https;
    lib.get(
      {
        hostname: t.hostname,
        path: t.pathname + t.search,
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
      },
      (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => resolve({ status: r.statusCode, body: d, type: r.headers['content-type'] || '' }));
      },
    ).on('error', reject);
  });
}

/* ------------------------------------------------------- route: MovieZone ---- */
async function handleMovieZone(req, res, u) {
  const key = u.pathname + u.search;
  const hit = cacheGet('mz:' + key);
  if (hit) { res.writeHead(200, { 'Content-Type': hit.type, 'Access-Control-Allow-Origin': '*', 'X-Cache': 'HIT' }); return res.end(hit.body); }

  try {
    const r = await fetchText(MZ + key);
    let body = r.body;
    if (r.status === 200) {
      // Perbaiki URL gambar relatif (kalau ada) + tulis ulang ke server sendiri?
      // Kita biarkan absolut; next/image sudah absolut (image.tmdb.org).
      cacheSet('mz:' + key, body, 'application/json; charset=utf-8');
    }
    res.writeHead(r.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'MISS',
    });
    res.end(body);
  } catch (e) {
    json(res, 502, { error: 'moviezone gagal: ' + e.message });
  }
}

/* -------------------------------------------------------- route: stream ---- */
async function handleStream(req, res, u) {
  const tmdb = u.searchParams.get('tmdb');
  const type = (u.searchParams.get('type') || 'movie').toLowerCase();
  const season = Number(u.searchParams.get('season') || 0);
  const episode = Number(u.searchParams.get('episode') || 0);
  const multi = u.searchParams.get('multiLang') || 'false';
  if (!tmdb) return json(res, 400, { error: 'tmdb wajib' });

  const key = `st:${type}:${tmdb}:${season}:${episode}:${multi}`;
  const hit = cacheGet(key);
  if (hit) return json(res, 200, JSON.parse(hit.body));

  try {
    const raw = await wasm.stream(tmdb, type, season, episode, multi);
    const s = raw && raw.stream;
    if (!s || !s.qualities) return json(res, 404, { error: 'stream tidak tersedia', raw });

    // Ubah URL CDN → URL yang benar-benar bisa diputar.
    //
    // KUNCI (hasil bedah kode player + uji langsung):
    //  · CDN (bcdn*.hakunaymatata.com) MENOLAK akses langsung → 428 tanpa
    //    Referer, 429 dengan Referer (blokir nginx).
    //  · Player VidLink TIDAK PERNAH menyentuh CDN langsung. Semua permintaan
    //    media lewat perantara noon.mooncase.online:
    //        /mp/<path>?sign=&t=&headers=<json>&host=<cdn>   (mp4)
    //        /sacdn/<path>?host=&sc=<base64 cookie>          (dash/hls)
    //  · Perantara itulah yang membuat tanda tangan CloudFront (sc).
    //    Algoritmanya sudah disalin ke lunar-vidlink-transform.js.
    const transformed = transform.D(raw, VIDEO_PROXY);
    const ts = (transformed && transformed.stream) || s;

    const qualities = {};
    for (const [q, v] of Object.entries(ts.qualities || {})) {
      qualities[q] = {
        label: q + 'p',
        type: v.type || 'mp4',
        codec: v.codecName || null,
        size: v.size ? Number(v.size) : null,
        sizeText: v.size ? humanSize(Number(v.size)) : null,
        url: proxyify(v.url, cdn.register),
      };
    }

    // Subtitle
    const captions = (ts.captions || []).map((c) => ({
      language: c.language,
      url: '/s/' + cdn.registerSub(c.url) + '.vtt',
    }));

    const out = {
      sourceId: raw.sourceId || null,
      type: ts.type || s.type || 'file',
      ttl: s.TTL || 3600,
      qualities,
      captions,
      // berkas mentah tetap dikirim untuk debug (bisa dimatikan dgn ?debug=0)
      _raw: u.searchParams.get('debug') === '1' ? ts : undefined,
    };
    cacheSet(key, JSON.stringify(out), 'application/json');
    json(res, 200, out);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

/* --------------------------------------------------------- route: video ---- */
function handleVideo(req, res, id) {
  const e = cdn.lookup(id);
  if (!e) return json(res, 404, { error: 'video id tidak dikenal / kedaluwarsa' });
  cdn.pipeVideo(req, res, e);
}

function handleSub(req, res, id) {
  const e = cdn.subMap.get(id);
  if (!e) return json(res, 404, { error: 'subtitle tidak ada' });
  cdn.pipeSubtitle(req, res, e, true);
}

/* ---------------------------------------------------------------- server ---- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
    return res.end();
  }

  // luar biasa — health
  if (p === '/health' || p === '/') {
    return json(res, 200, {
      ok: true, uptime: Math.round(process.uptime()), node: process.version,
      cache: { size: cache.size, hits: cacheHits, miss: cacheMiss },
      videos: cdn.videoMap.size, subs: cdn.subMap.size,
      ts: new Date().toISOString(),
    });
  }

  // stream resolver
  if (p === '/stream') return handleStream(req, res, u);

  // proxy video & subtitle
  if (p.startsWith('/v/')) return handleVideo(req, res, p.slice(3));
  if (p.startsWith('/s/')) return handleSub(req, res, p.slice(3).replace(/\.vtt$/, ''));

  // sisa → teruskan ke MovieZone
  if (p.startsWith('/api/')) return handleMovieZone(req, res, u);

  json(res, 404, { error: 'rute tidak ada', path: p });
});

/* --------------------------------------------------------------- warm up ---- */
wasm.init()
  .then(() => console.log('[lunar] WASM siap'))
  .catch((e) => console.error('[lunar] WASM gagal:', e.message));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[lunar] server jalan di :${PORT}`);
});
