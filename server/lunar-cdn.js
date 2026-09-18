/**
 * lunar-cdn.js — proxy video + subtitle.
 *
 * KENYATAAN (hasil uji langsung):
 *  • CDN (bcdn.hakunaymatata.com / noon.mooncase.online) menolak akses langsung:
 *      428 Forbidden  → tanpa Referer
 *      429            → terlalu sering (rate limit Cloudflare)
 *  • Perlu: Referer https://vidlink.pro/ + cookie CloudFront (dari player)
 *  • MP4 biasa TIDAK perlu cookie; cukup Referer + IP yang tidak diblokir.
 *
 * Jadi server ini WAJIB jadi proxy: HP minta /v/<id>, server ambil dari CDN
 * dengan header yang benar, lalu teruskan (termasuk Range agar seek jalan).
 */
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

/** Menyimpan URL asli per-id sementara (TTL 1 jam). */
const videoMap = new Map();   // id -> {url, referer, expires}
const subMap = new Map();     // id -> {url}

/** Bikin id pendek dari URL. */
function hash(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
}

/** Daftarkan URL video → balikin id untuk proxy. */
function register(url, referer) {
  const id = hash(url);
  videoMap.set(id, { url, referer: referer || 'https://vidlink.pro/', expires: Date.now() + 3600_000 });
  return id;
}

function registerSub(url) {
  const id = hash(url);
  subMap.set(id, { url });
  return id;
}

function lookup(id) {
  const v = videoMap.get(id);
  if (v && v.expires > Date.now()) return v;
  if (v) videoMap.delete(id);
  return null;
}

/**
 * Stream dari CDN ke response klien.
 * Meneruskan Range + semua header penting.
 *
 * Tahan 429/403: coba beberapa set header (Cloudflare kadang hanya melihat
 * kombinasi Referer+Origin tertentu), beri jeda kecil antar percobaan.
 */
function pipeVideo(req, res, entry, attempt = 0) {
  const target = new URL(entry.url);

  // Variasi header: lama-lama makin "mirip browser asli"
  const variants = [
    { Referer: entry.referer || 'https://vidlink.pro/', Origin: 'https://vidlink.pro' },
    { Referer: 'https://vidlink.pro/', Origin: 'https://vidlink.pro', 'Sec-Fetch-Dest': 'video', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'cross-site' },
    { Referer: 'https://vidlink.pro/', Origin: 'https://vidlink.pro', 'Accept-Encoding': 'identity;q=1, *;q=0', 'Accept-Language': 'en-US,en;q=0.9' },
  ];
  const v = variants[Math.min(attempt, variants.length - 1)];

  const headers = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...v,
  };
  if (req.headers.range) headers['Range'] = req.headers.range;
  if (entry.cookie) headers['Cookie'] = entry.cookie;

  const lib = target.protocol === 'http:' ? http : https;
  const proxied = lib.request(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      method: 'GET',
      headers,
    },
    (up) => {
      // CDN sibuk (429/403/5xx) → coba lagi dengan header lain
      const retryable = up.statusCode === 429 || up.statusCode === 403 || up.statusCode >= 500;
      if (retryable && attempt < 3) {
        up.resume(); // buang body
        return setTimeout(() => pipeVideo(req, res, entry, attempt + 1), 400 * (attempt + 1));
      }

      if (up.statusCode !== 200 && up.statusCode !== 206) {
        // sudah mentok: kirim apa adanya (biar klien tahu status nyata)
        const out = {
          'Content-Type': up.headers['content-type'] || 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'X-Lunar-Upstream': String(up.statusCode),
        };
        res.writeHead(up.statusCode, out);
        return up.pipe(res);
      }

      const outHeaders = {
        'Content-Type': up.headers['content-type'] || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        'Cache-Control': 'public, max-age=3600',
        'X-Lunar-Attempt': String(attempt),
      };
      for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
        if (up.headers[h]) outHeaders[h] = up.headers[h];
      }
      res.writeHead(up.statusCode, outHeaders);
      up.pipe(res);
    },
  );
  proxied.on('error', (e) => {
    if (attempt < 2) return setTimeout(() => pipeVideo(req, res, entry, attempt + 1), 400);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('proxy error: ' + e.message);
  });
  req.on('close', () => proxied.destroy());
  proxied.end();
}

/** Subtitle: .srt → teruskan apa adanya (atau ubah ke VTT kalau minta). */
function pipeSubtitle(req, res, entry, asVtt) {
  const target = new URL(entry.url);
  const lib = target.protocol === 'http:' ? http : https;
  const r = lib.request(
    {
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: 'GET',
      headers: { 'User-Agent': UA, 'Referer': 'https://vidlink.pro/', 'Accept': '*/*' },
    },
    (up) => {
      let chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        let text = Buffer.concat(chunks).toString('utf8');
        if (asVtt) text = srtToVtt(text);
        res.writeHead(up.statusCode === 200 ? 200 : up.statusCode, {
          'Content-Type': asVtt ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(text);
      });
    },
  );
  r.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(''); });
  r.end();
}

/** SRT → WebVTT (ExoPlayer lebih suka VTT). */
function srtToVtt(srt) {
  const body = srt.replace(/\r+/g, '').replace(/^\uFEFF/, '');
  const conv = body.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2',
  );
  return 'WEBVTT\n\n' + conv;
}

module.exports = { register, registerSub, lookup, pipeVideo, pipeSubtitle, srtToVtt, videoMap, subMap };
