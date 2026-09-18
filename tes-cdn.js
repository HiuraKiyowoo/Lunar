#!/usr/bin/env node
/* tes-cdn.js — uji jalur CDN langsung (tanpa perantara) dari VPS */
const https = require('https');
const UA_SHORT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

function probe(url, headers) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: Object.assign({ Range: 'bytes=0-300000', 'User-Agent': UA_SHORT }, headers),
    }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; if (n > 350000) res.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, bytes: n, type: res.headers['content-type'] || '' }));
      res.on('close', () => resolve({ status: res.statusCode, bytes: n, type: res.headers['content-type'] || '' }));
    });
    req.on('error', (e) => resolve({ status: 0, bytes: 0, err: e.message }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, err: 'timeout' }); });
    req.end();
  });
}

(async () => {
  // ambil URL fresh dari server lokal
  const api = await new Promise((res) => {
    https.get('https://api-lunar.zone.id/stream?tmdb=550&type=movie&debug=1', (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } });
    }).on('error', () => res(null));
  });
  if (!api) { console.log('gagal ambil /stream'); process.exit(1); }

  const raw = api._raw || {};
  const quals = raw.qualities || {};
  const keys = Object.keys(quals);
  console.log('kualitas tersedia:', keys.join(', '));

  for (const k of keys) {
    const v = quals[k];
    const u = new URL(v.url);
    const host = u.searchParams.get('host');
    const sign = u.searchParams.get('sign');
    const t = u.searchParams.get('t');
    // buang prefix /mp/
    const p = u.pathname.replace(/^\/mp\//, '/');
    const direct = host.replace(/\/$/, '') + p + `?sign=${sign}&t=${t}`;
    const hs = v.headers && Object.keys(v.headers).length ? v.headers : { Referer: 'https://filmboom.top/', Origin: 'https://filmboom.top' };

    const r1 = await probe(u.toString(), { Referer: 'https://vidlink.pro/' });
    // uji DUA aturan: (a) apa adanya dari server, (b) tanpa referer sama sekali
    const r2 = await probe(direct, hs);
    const r3 = await probe(direct, {});
    console.log(`  ${k}:`);
    console.log(`     perantara : ${r1.status} ${r1.bytes}B ${r1.type||r1.err||''}`);
    const ok = (x) => x.status===200||x.status===206;
    console.log(`     CDN (headers server): ${r2.status} ${r2.bytes}B ${r2.type||r2.err||''}   ${ok(r2)?'✅ JALAN':'❌'}`);
    console.log(`     CDN (tanpa referer) : ${r3.status} ${r3.bytes}B ${r3.type||r3.err||''}   ${ok(r3)?'✅ JALAN':'❌'}`);
    console.log(`     URL: ${direct.slice(0,120)}`);
  }
})();
