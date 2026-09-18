/**
 * probe.cjs — uji cepat sebuah situs pemutar: layak dipakai atau tidak.
 *
 * Pakai:
 *     node probe.cjs "https://situs-baru/embed/movie/550"
 *     node probe.cjs "https://situs-baru/embed/movie/550" "https://situs2/embed/550"
 *
 * Yang dilaporkan:
 *   - jam (detik) saat setiap alamat media muncul
 *   - apakah play-list HLS atau berkas .mp4 bertanda tangan
 *   - apakah halaman memakai proof-of-work / captcha (penyebab lambat)
 *   - apakah video benar-benar mulai diputar (<video>.currentTime naik)
 *
 * Putusan akhir:
 *   "LAYAK"   ada HLS dalam < 12 detik  → pakai sebagai pemutar utama
 *   "LAMBAT"  ada HLS tetapi > 12 detik → PoW, hanya cadangan
 *   "BUANG"   tak ada HLS / butuh klik  → jangan dipakai
 */
const { chromium } = require('playwright');

const urls = process.argv.slice(2);
if (!urls.length) {
  console.log('Pakai: node probe.cjs "<url>" ["<url2>" ...]');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';

const MEDIA_RE = /\.m3u8|\.mpd|\/api\/playlist\/|\/mp\/|sacdn|\.mp4/i;
const NOISE_RE = /\.(jpg|jpeg|png|gif|webp|css|js|json|svg|woff2?|ttf|srt|vtt)(\?|$)/i;
const POW_RE = /pow-worker|pow-v3|proof-of-work|turnstile|hcaptcha|recaptcha/i;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    ],
  });

  for (const url of urls) {
    const t0 = Date.now();
    const media = [];       // { t, url }
    let powAt = null;       // jam pertama kali PoW terlihat
    let first = null;       // detik media pertama
    let firstHls = null;    // detik HLS pertama

    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();

    page.on('request', (r) => {
      const u = r.url();
      const t = (Date.now() - t0) / 1000;
      if (POW_RE.test(u) && powAt === null) powAt = t;
      if (!MEDIA_RE.test(u) || NOISE_RE.test(u)) return;
      media.push({ t, url: u });
      if (first === null) first = t;
      if (/\.m3u8|\/api\/playlist\/|\/mp\//i.test(u) && firstHls === null) firstHls = t;
    });

    console.log(`\n${'='.repeat(70)}`);
    console.log(`UJI  ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Periksa video di DOM tiap 2 detik supaya tahu apakah benar diputar.
      for (let i = 0; i < 45; i++) {
        await page.waitForTimeout(2000);
        const st = await page.evaluate(() => {
          const v = document.querySelector('video');
          if (!v) return null;
          return { cur: v.currentSrc || v.src || '', time: v.currentTime, ready: v.readyState };
        }).catch(() => null);
        if (st && st.cur && first === null) { first = (Date.now() - t0) / 1000; media.push({ t: first, url: st.cur }); }
        if (st && st.time > 0.5) {
          console.log(`   <video> MULAI MUTAR di detik ${((Date.now() - t0) / 1000).toFixed(1)}`);
          break;
        }
      }
    } catch (e) {
      console.log(`   GAGAL buka: ${e.message}`);
    }

    console.log(`   PoW/captcha : ${powAt === null ? 'TIDAK ✓' : `YA (detik ${powAt.toFixed(1)}) ❌`}`);
    console.log(`   media pertama: ${first === null ? '(tidak ada)' : first.toFixed(1) + 's'}`);
    console.log(`   HLS pertama  : ${firstHls === null ? '(tidak ada)' : firstHls.toFixed(1) + 's'}`);

    const uniq = [];
    const seen = new Set();
    for (const m of media) {
      const key = m.url.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(m);
    }
    console.log(`   ${uniq.length} alamat media:`);
    for (const m of uniq.slice(0, 10)) console.log(`     ${m.t.toFixed(1)}s  ${m.url.slice(0, 110)}`);

    let putusan = 'BUANG';
    if (firstHls !== null && firstHls < 12 && powAt === null) putusan = 'LAYAK ⭐';
    else if (firstHls !== null && firstHls < 25) putusan = 'LAMBAT (cadangan)';
    console.log(`   PUTUSAN: ${putusan}`);

    await ctx.close().catch(() => {});
  }
  await browser.close();
})();
