/**
 * lunar-hls.js — proxy HLS (m3u8) untuk pemutar cadangan.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MODUL INI ADA
 * ---------------------------------------------------------------------------
 * Pemutar utama (VidLink) mengirim .mp4 bertanda tangan yang cepat kedaluwarsa
 * dan CDN-nya menolak IP datacenter — sudah mentok setelah berbagai percobaan.
 *
 * Pemutar cadangan (VidSrcWiki → cinesrc.st) justru mengirim HLS:
 *   · tidak ada tanda tangan/timestamp  → tidak pernah "kedaluwarsa"
 *   · segmen video ada di nebula.bright67.online yang TIDAK memblokir siapa pun
 *     (diuji: 200 video/mp4 dari IP datacenter, dengan maupun tanpa Referer)
 *   · kualitas lebih tinggi (1080p)
 *
 * Satu-satunya kerumitan: play-list turunan (sub-playlist) hanya dilayani bila
 * permintaannya berasal dari sesi browser yang benar. Karena itu semua permintaan
 * HLS dialihkan lewat sini — server menyimpan cookie sesi hasil Chromium dan
 * menyertakannya, lalu MENULIS ULANG setiap URL di dalam play-list supaya
 * pemutar (ExoPlayer) meminta ke server ini, bukan langsung ke sumber.
 *
 * Hasil akhir: pemutaran 100% native di perangkat, tanpa iklan, tanpa blokir.
 */

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const UA = process.env.HLS_UA
  || 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

const MAX_HOPS = 4;               // kedalaman play-list (master → varian → …)
const TTL = Number(process.env.HLS_TTL || 3600);

/** id → { url, referer, cookie, base, expires } */
const map = new Map();

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);

/**
 * Daftarkan URL HLS (biasanya master .m3u8) beserta konteks sesi.
 *
 * @param {object} o { url, referer, cookie }
 * @returns {string} id untuk dipakai di /v/<id>
 */
function register(o) {
  const id = hash(o.url);
  map.set(id, {
    url: o.url,
    referer: o.referer || '',
    cookie: o.cookie || '',
    expires: Date.now() + TTL * 1000,
  });
  return id;
}

function lookup(id) {
  const e = map.get(id);
  if (e && e.expires > Date.now()) return e;
  if (e) map.delete(id);
  return null;
}

/** Bersihkan entri kedaluwarsa sesekali. */
function gc() {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires < now) map.delete(k);
}

/* ------------------------------------------------------------ pengambilan -- */

/** Lakukan permintaan HTTP(S) dan kembalikan {status, headers, body(Buffer)}. */
function fetchAll(target, ctx, headers = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(target); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;

    const h = {
      'User-Agent': UA,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (ctx && ctx.cookie) h['Cookie'] = ctx.cookie;
    // Sumber HLS memakai Referer untuk memastikan permintaan datang dari konteks
    // yang benar; tanpa itu sub-playlist menjawab 400.
    if (ctx && ctx.referer) h['Referer'] = ctx.referer;
    // diwarisi dari permintaan pemutar
    if (headers.range) h['Range'] = headers.range;
    Object.assign(h, headers.extra || {});

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'GET',
        headers: h,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }));
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** Apakah isi ini play-list HLS? */
function isPlaylist(body, headers) {
  const ct = String(headers['content-type'] || '');
  const txt = body.slice(0, 200).toString('utf8');
  return ct.includes('mpegurl') || txt.startsWith('#EXTM3U');
}

/**
 * Tulis ulang play-list: setiap URI (varian, kunci, segmen, MAP) diarahkan
 * kembali ke server ini, sambil mewarisi konteks sesi.
 */
function rewritePlaylist(text, absBase, ctx) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (!line.trim()) { out.push(line); continue; }

    if (line.startsWith('#')) {
      // Tag yang mengandung URI: #EXT-X-MAP:URI="...", #EXT-X-KEY:URI="...",
      // #EXT-X-MEDIA:URI="...", #EXT-X-I-FRAME-STREAM-INF:URI="..."
      out.push(line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = toAbsolute(uri, absBase);
        const id = register({ url: abs, referer: ctx.referer, cookie: ctx.cookie });
        return `URI="${abs}${abs.includes('?') ? '&' : '?'}__l=${id}"`;
      }));
      continue;
    }

    // baris biasa = URI segmen atau play-list turunan
    const abs = toAbsolute(line, absBase);
    const id = register({ url: abs, referer: ctx.referer, cookie: ctx.cookie });
    out.push(`${abs}${abs.includes('?') ? '&' : '?'}__l=${id}`);
  }
  return out.join('\n');
}

function toAbsolute(uri, base) {
  try { return new URL(uri, base).toString(); } catch (_) { return uri; }
}

/** Setelah play-list ditulis ulang, apakah ada URI di dalamnya? */
function hasUris(text) {
  return text.split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('#'));
}

/* ------------------------------------------------------------ jalur serve -- */

/**
 * Layani /v/<id> sebagai proxy HLS.
 *
 * Karena URL di dalam play-list sudah ditulis ulang menjadi absolut (tanpa
 * penanda khusus), permintaan lanjutan datang sebagai URL sumber apa adanya.
 * Server mengenali hal itu dari ketiadaan id di peta, lalu mengambil dengan
 * header yang benar — jadi pemutar tetap meminta ke server ini.
 */
async function serve(req, res, id) {
  gc();

  // 1) id terdaftar → ini play-list
  let entry = lookup(id);
  if (entry) {
    return servePlaylist(req, res, entry);
  }

  // 2) id tidak dikenal → pemutar mungkin meminta URL segmen yang sudah
  //    ditulis ulang; cari entri yang cocok lewat daftar (fallback aman).
  const found = findByUrl(id);
  if (found) return servePlaylist(req, res, found);

  return head(res, 404, { 'Content-Type': 'text/plain' }, 'id tidak dikenal');
}

/**
 * Sebagian pemutar menormalkan URL absolut dan membuang query — untuk itu
 * diperlukan pencocokan berdasarkan bagian akhir URL.
 */
function findByUrl(id) {
  for (const [, v] of map) {
    if (v.url.endsWith(id)) return v;
  }
  return null;
}

async function servePlaylist(req, res, entry) {
  let up;
  try {
    up = await fetchAll(entry.url, entry, { range: req.headers.range });
  } catch (e) {
    return head(res, 502, { 'Content-Type': 'text/plain' }, 'gagal mengambil: ' + e.message);
  }

  if (up.status !== 200 && up.status !== 206) {
    return head(res, up.status, { 'Content-Type': 'text/plain' },
      `sumber menjawab ${up.status}`);
  }

  // Segmen video: teruskan apa adanya (jangan diubah — isinya biner).
  if (!isPlaylist(up.body, up.headers)) {
    const h = {
      'Content-Type': up.headers['content-type'] || 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Cache-Control': 'public, max-age=3600',
    };
    for (const k of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      if (up.headers[k]) h[k] = up.headers[k];
    }
    res.writeHead(up.status, h);
    return res.end(up.body);
  }

  // Play-list: tulis ulang agar semua URI kembali ke server ini.
  const base = entry.url;
  let text = up.body.toString('utf8');
  text = rewritePlaylist(text, base, entry);

  // Kalau setelah ditulis ulang tidak ada URI tersisa, kemungkinan URI-nya
  // sudah absolut dan tidak berubah — tetap kirimkan apa adanya.
  const buf = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Content-Length': String(buf.length),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'X-Lunar-Hls': hasUris(text) ? 'rewritten' : 'passthrough',
  });
  return res.end(buf);
}

function head(res, code, headers, body) {
  if (!res.headersSent) res.writeHead(code, { 'Access-Control-Allow-Origin': '*', ...headers });
  return res.end(body);
}

/** Statistik untuk /health. */
function stats() {
  gc();
  return { entries: map.size };
}

module.exports = { register, lookup, serve, stats, map, hash };
