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

/** Batas jumlah entri; play-list panjang (799 segmen) cepat memenuhi memori. */
const MAX_ENTRIES = Number(process.env.HLS_MAX || 200_000);
// Entri HLS berumur panjang: film bisa 2+ jam dan pemutar boleh di-pause lama.
// Kalau entri kedaluwarsa saat playback berjalan, permintaan segmen berikutnya
// akan gagal. 6 jam memberi ruang aman.
const TTL = Number(process.env.HLS_TTL || 21_600);

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
  if (map.size > MAX_ENTRIES) {
    // buang yang paling tua sampai di bawah batas
    const keys = [...map.entries()].sort((a, b) => a[1].expires - b[1].expires);
    for (let i = 0; i < keys.length - MAX_ENTRIES + 1000; i++) map.delete(keys[i][0]);
  }
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
  // Semua URI diarahkan ke server ini sebagai path RELATIF.
  //  · Relatif penting: kalau absolut, pemutar yang menormalkan URL bisa
  //    membuang query dan meminta langsung ke sumber (yang menjawab 400).
  //  · Ekstensi dipertahankan (.m3u8 / .mp4 / .ts) supaya pemutar tahu
  //    jenis isinya — segmen sumber dikirim sebagai image/jpeg walau berisi
  //    fMP4, dan ExoPlayer menolak kalau ekstensinya menyesatkan.
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (!line.trim()) { out.push(line); continue; }

    const toLocal = (uri) => {
      const abs = toAbsolute(uri, absBase);
      const id = register({ url: abs, referer: ctx.referer, cookie: ctx.cookie });
      // tentukan ekstensi
      let ext = '.m3u8';
      const m = abs.match(/\.(m3u8|mp4|ts|m4s|jpg|key)(\?|$)/i);
      if (m) ext = m[0].split('?')[0].toLowerCase();
      if (ext === '.jpg' || ext === '.m4s') ext = '.mp4';
      if (ext === '.key') ext = '.bin';
      return `/v/${id}${ext}`;
    };

    if (line.startsWith('#')) {
      out.push(line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${toLocal(uri)}"`));
      continue;
    }

    out.push(toLocal(line));
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
async function serve(req, res, id, ext) {
  gc();

  // 1) id terdaftar → ini play-list
  let entry = lookup(id);
  if (entry) {
    // Perpanjang umur tiap kali dipakai: selama pemutar masih meminta segmen,
    // entri tidak boleh kedaluwarsa di tengah playback.
    entry.expires = Date.now() + TTL * 1000;
    return servePlaylist(req, res, entry, ext);
  }

  // 2) id tidak dikenal → pemutar mungkin meminta URL segmen yang sudah
  //    ditulis ulang; cari entri yang cocok lewat daftar (fallback aman).
  const found = findByUrl(id);
  if (found) return servePlaylist(req, res, found, ext);

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

async function servePlaylist(req, res, entry, ext) {
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
    // Sumber memberi segmen sebagai image/jpeg padahal isinya fMP4 (styp).
    // ExoPlayer menolak kalau jenis isi salah, jadi periksa isinya.
    let ct = up.headers['content-type'] || 'video/mp4';
    const magic = up.body.slice(0, 12).toString('latin1');
    if (magic.includes('ftyp') || magic.includes('styp') || /\.(ts|m4s|mp4)$/i.test(ext || '')) {
      ct = /styp|ftyp/.test(magic) ? 'video/mp4' : ct;
    }
    if (ext === '.ts') ct = 'video/mp2t';
    const h = {
      'Content-Type': ct,
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
