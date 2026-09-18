/**
 * lunar-warm.js — memasak video lebih dulu di belakang layar.
 *
 * ---------------------------------------------------------------------------
 * MASALAH YANG DIPECAHKAN
 * ---------------------------------------------------------------------------
 * Mengambil alamat video dari halaman pemutar memakan 45-75 detik: halaman
 * itu memang lambat (proof-of-work + beberapa tahap). Waktu itu dibayar
 * SETIAP KALI ada yang membuka judul yang belum pernah dimasak.
 *
 * Kalau hasilnya sudah ada di cache, jawabannya keluar seketika. Jadi
 * daripada membiarkan PENGGUNA menunggu, server yang menunggu — lebih dulu,
 * saat tidak ada yang meminta.
 *
 * ---------------------------------------------------------------------------
 * URUTAN PRIORITAS
 * ---------------------------------------------------------------------------
 * 1. permintaan    apa pun yang sedang diminta pengguna — didahulukan
 * 2. populer       film & series yang paling banyak ditonton
 * 3. terbaru       rilisan baru, sering dicari
 * 4. episode       sisa episode dari series yang baru saja dibuka
 * 5. katalog       sisanya, pelan-pelan sampai habis
 *
 * Katalog MovieZone berisi sekitar 20.000 judul. Dimasak satu per satu dengan
 * jeda, itu urusan berminggu-minggu — dan itu memang disengaja: permintaan
 * yang terlalu rapat ke situs pemutar membuat IP server dicurigai lalu
 * diblokir, dan kalau itu terjadi SEMUA judul ikut mati, bukan hanya lambat.
 *
 * ---------------------------------------------------------------------------
 * PENGATURAN (variabel lingkungan)
 * ---------------------------------------------------------------------------
 *   WARM=0                 matikan sama sekali
 *   WARM_GAP_MS=120000     jeda antar judul (2 menit)
 *   WARM_START_MS=90000    tunggu sekian ms setelah server hidup baru mulai
 *   WARM_POPULER=600       berapa judul populer dimasak lebih dulu
 *   WARM_EPISODE=12        berapa episode lanjutan per series yang dibuka
 */

'use strict';

const fs = require('fs');
const path = require('path');
const play = require('./lunar-play.js');

const GAP_MS = Number(process.env.WARM_GAP_MS || 120_000);
const START_MS = Number(process.env.WARM_START_MS || 90_000);
const POPULER = Number(process.env.WARM_POPULER || 600);
const EPISODE_MAKS = Number(process.env.WARM_EPISODE || 12);
const ENABLED = process.env.WARM !== '0';

/** Berkas antrian — supaya pekerjaan tidak hilang saat server dinyalakan ulang. */
const QUEUE_FILE = process.env.WARM_FILE
  || path.join(process.env.LUNAR_DATA_DIR || __dirname, 'warm-queue.json');

const state = {
  enabled: ENABLED,
  running: false,
  /** `${type}:${id}:${s}:${e}` → { id, type, s, e, judul, prio, coba } */
  antrian: new Map(),
  /** yang sudah selesai, supaya tidak dimasak dua kali */
  selesai: new Set(),
  now: null,
  mulai: null,
  dihentikan: false,
};

/* ------------------------------------------------------------ penyimpanan --- */

function simpan() {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({
      antrian: [...state.antrian.values()],
      selesai: [...state.selesai].slice(-40_000),
    }));
  } catch (_) { /* antrian sekunder — gagal simpan tidak fatal */ }
}

function muat() {
  try {
    const j = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    for (const t of (j.antrian || [])) state.antrian.set(kunci(t), t);
    for (const k of (j.selesai || [])) state.selesai.add(k);
  } catch (_) { /* belum ada berkas — mulai dari kosong */ }
}

const kunci = (t) => `${t.type}:${t.id}:${t.s || 0}:${t.e || 0}`;

/* --------------------------------------------------------------- bantuan ---- */

function tidur(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tambah(t) {
  const k = kunci(t);
  if (state.selesai.has(k)) return false;
  const ada = state.antrian.get(k);
  if (ada) {
    // prio lebih kecil = lebih penting. Kalau permintaan pengguna (prio 1),
    // naikkan walau sudah ada di antrian.
    if ((t.prio || 9) < (ada.prio || 9)) ada.prio = t.prio;
    return false;
  }
  state.antrian.set(k, t);
  return true;
}

/**
 * Antrikan sebuah judul karena SEDANG DIMINTA pengguna.
 * Dipanggil server.js saat /stream?engine=play dipanggil.
 */
function minta(tmdb, type, season, episode) {
  tambah({
    id: Number(tmdb), type: type || 'movie',
    s: season || 0, e: episode || 0,
    judul: `permintaan ${tmdb}`, prio: 1,
  });
  // Series: episode berikutnya menyusul, supaya berpindah episode tidak
  // menunggu dari nol lagi.
  if (type === 'tv' && season > 0) {
    for (let e = (episode || 1) + 1; e <= (episode || 1) + EPISODE_MAKS; e++) {
      tambah({ id: Number(tmdb), type: 'tv', s: season, e, judul: `lanjutan ${tmdb} S${season}E${e}`, prio: 4 });
    }
  }
  simpan();
}

/* ------------------------------------------------------------- pengambilan -- */

/** Ambil daftar judul dari katalog sendiri (MovieZone lewat server ini). */
async function dariKatalog(jalur, type, prio, maks) {
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const keluar = [];
  const halamanMaks = Math.ceil(maks / 20);
  for (let p = 1; p <= halamanMaks; p++) {
    try {
      const sep = jalur.includes('?') ? '&' : '?';
      const r = await fetch(`${base}${jalur}${sep}page=${p}`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) break;
      const j = await r.json();
      const hasil = j.results || j.items || [];
      if (!hasil.length) break;
      for (const it of hasil) {
        const id = it.tmdbId || it.tmdb || it.id_tmdb || (it.ids && it.ids.tmdb);
        if (!id) continue;
        keluar.push({
          id: Number(id), type,
          s: type === 'tv' ? 1 : 0, e: type === 'tv' ? 1 : 0,
          judul: it.title || it.name || String(id), prio,
        });
        if (keluar.length >= maks) break;
      }
    } catch (_) { break; }
    if (keluar.length >= maks) break;
  }
  return keluar;
}

/** Isi antrian awal: populer dulu, lalu (pelan-pelan) sisa katalog. */
async function isiAntrian() {
  let baru = 0;
  const populer = [
    ...await dariKatalog('/api/movies/popular?type=movie', 'movie', 2, POPULER / 2),
    ...await dariKatalog('/api/movies/trending?type=movie', 'movie', 2, POPULER / 2),
    ...await dariKatalog('/api/movies/popular?type=tv', 'tv', 2, POPULER / 2),
    ...await dariKatalog('/api/movies/trending?type=tv', 'tv', 2, POPULER / 2),
  ];
  for (const t of populer) if (tambah(t)) baru++;

  // Terbaru berikutnya.
  for (const t of await dariKatalog('/api/movies/latest?type=all', 'movie', 3, 200)) if (tambah(t)) baru++;

  console.log(`[warm] antrian awal: +${baru} judul (total ${state.antrian.size})`);
  simpan();
}

/**
 * Isi sisa katalog pelan-pelan.
 *
 * Dijalankan di latar belakang: menyisir 1001 halaman memakan waktu dan
 * memori, jadi hasilnya ditumpahkan ke antrian sedikit demi sedikit sambil
 * pekerja utama tetap memasak.
 */
async function isiKatalogBertahap() {
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  for (const type of ['movie', 'tv']) {
    for (let p = 1; p <= 1001; p++) {
      if (!state.enabled || state.dihentikan) return;
      try {
        const r = await fetch(`${base}/api/movies/discover?type=${type}&page=${p}`, { signal: AbortSignal.timeout(30_000) });
        if (!r.ok) break;
        const j = await r.json();
        const hasil = j.results || [];
        if (!hasil.length) break;
        let baru = 0;
        for (const it of hasil) {
          const id = it.tmdbId || it.tmdb || (it.ids && it.ids.tmdb);
          if (!id) continue;
          if (tambah({
            id: Number(id), type,
            s: type === 'tv' ? 1 : 0, e: type === 'tv' ? 1 : 0,
            judul: it.title || it.name || String(id), prio: 5,
          })) baru++;
        }
        if (baru) { simpan(); }
        // jeda supaya penyisiran katalog tidak membebani MovieZone
        await tidur(1500);
      } catch (_) { break; }
    }
  }
  console.log('[warm] penyisiran katalog selesai');
}

/* ---------------------------------------------------------------- pekerja --- */

async function pekerja() {
  if (!ENABLED) return;
  if (!play.available()) {
    console.log('[warm] dilewati — Chromium belum siap');
    return;
  }
  await tidur(START_MS);
  if (state.running) return;

  muat();
  state.running = true;
  state.mulai = Date.now();
  console.log(`[warm] pekerja mulai — antrian ${state.antrian.size} judul`);

  // Isi antrian di latar (jangan menahan pekerja).
  isiAntrian().catch((e) => console.log('[warm] isi antrian:', e.message));
  isiKatalogBertahap().catch((e) => console.log('[warm] isi katalog:', e.message));

  while (state.enabled && !state.dihentikan) {
    // Ambil judul dengan prioritas terkecil (paling penting) lebih dulu.
    let terpilih = null;
    for (const t of state.antrian.values()) {
      if (!terpilih || (t.prio || 9) < (terpilih.prio || 9)) terpilih = t;
    }
    if (!terpilih) { await tidur(15_000); continue; }

    const k = kunci(terpilih);
    state.now = `${terpilih.judul} (${terpilih.type} ${terpilih.id}${terpilih.e ? ' S' + terpilih.s + 'E' + terpilih.e : ''})`;

    try {
      const r = await play.extract(terpilih.id, terpilih.type, terpilih.s || 0, terpilih.e || 0, { force: true });
      if (r && r.url) {
        console.log(`[warm] ok — ${state.now} (${r.engine || '?'})`);
      } else {
        console.log(`[warm] kosong — ${state.now}`);
      }
    } catch (e) {
      console.log(`[warm] gagal — ${state.now}: ${String(e.message).slice(0, 80)}`);
    }

    state.antrian.delete(k);
    state.selesai.add(k);
    state.now = null;
    simpan();

    // Jeda: makin banyak permintaan tertunda, makin cepat (pengguna menunggu).
    const adaPermintaanPengguna = [...state.antrian.values()].some((t) => (t.prio || 9) === 1);
    await tidur(adaPermintaanPengguna ? 2_000 : GAP_MS);
  }

  state.running = false;
  console.log('[warm] pekerja berhenti');
}

/* ------------------------------------------------------------------ stats --- */

function stats() {
  const semua = [...state.antrian.values()];
  const per = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const t of semua) per[t.prio || 5] = (per[t.prio || 5] || 0) + 1;
  return {
    enabled: state.enabled,
    running: state.running,
    selesai: state.selesai.size,
    antrian: semua.length,
    permintaan: per[1] || 0,
    populer: per[2] || 0,
    terbaru: per[3] || 0,
    episode: per[4] || 0,
    katalog: per[5] || 0,
    now: state.now,
    menit: state.mulai ? Math.round((Date.now() - state.mulai) / 60_000) : 0,
    jedaDetik: Math.round(GAP_MS / 1000),
  };
}

function setEnabled(v) {
  state.enabled = !!v;
  if (!v) state.dihentikan = true;
  return state.enabled;
}

/** Antrikan sekumpulan judul populer sekarang (untuk uji cepat). */
async function masakSekarang(n = 20) {
  const daftar = await dariKatalog('/api/movies/popular?type=movie', 'movie', 2, n);
  let baru = 0;
  for (const t of daftar) if (tambah(t)) baru++;
  simpan();
  return { diminta: daftar.length, baru, antrian: state.antrian.size };
}

module.exports = { pekerja, stats, setEnabled, minta, masakSekarang, QUEUE_FILE };
