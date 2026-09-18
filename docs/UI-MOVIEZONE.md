# 🎨 UI MovieZone — Peta Desain untuk APK Lunar

Sumber: reverse dari chunk JS + CSS (`7a2b51c21bb0099d.css`)

---

## 1. IDENTITAS VISUAL

**Tema:** gelap (hitam pekat) + aksen **emas**. Nama: **Movie**`Zone` (Zone berwarna emas).

**Font:**
- Body/Default: `Inter, system-ui, sans-serif`
- Judul: `Space Grotesk, system-ui, sans-serif` (`font-display`)

**Palet warna (PERSIS dari CSS):**

| Token | Nilai | Pakai untuk |
|---|---|---|
| `ink` | `rgb(8,10,12)` = `#080A0C` | Background utama |
| `inkl` | `rgb(15,18,21)` = `#0F1215` | Background card/sheet |
| `inke` | `rgb(22,27,32)` = `#161B20` | Input, card sekunder |
| `gold` | `rgb(245,166,35)` = `#F5A623` | Aksen utama (tombol, bintang, aktif) |
| `goldf` | `rgba(245,166,35,.12)` | Background aktif (chip/pill) |
| `silver` | `rgb(160,170,180)` = `#A0AAB4` | Teks sekunder |
| `dim` | `rgb(80,90,101)` = `#505A65` | Teks tersier / ikon mati |
| `line` | `rgba(255,255,255,.07)` | Garis/border |
| `ghost` | `rgba(255,255,255,.05)` | Tombol transparan |
| teks utama | `#E8EDF2` | Judul item |

**Radius:** card poster `rounded-xl` (12px), section besar `rounded-2xl` (16px), sheet `rounded-t-3xl` (24px), pill `rounded-full`
**Bayangan:** `shadow-lg shadow-black/30` untuk poster, `shadow-gold/20` untuk tombol emas

---

## 2. STRUKTUR HOME (URUTAN PERSIS)

```
┌─ Header (fixed, h-14) ─────────────────────────────┐
│  [logo 7x7] MovieZone              [🔍 bulat 40px] │   ← logo "Movie" putih + "Zone" emas
└────────────────────────────────────────────────────┘
   • scroll >60px → background gradient hitam + blur(12px)
   • di /movie & /watch → header HILANG

1. HERO CAROUSEL  (/api/movies/hero)
   - tinggi 78vw (max 460, min 320)
   - progress bar di ATAS (h-1, flex gap-0.5, segmen per slide)
     · aktif = bg-gold dgn animasi heroProgress 6000ms linear
     · sudah lewat = bg-gold/70
   - gambar: opacity 0.6s + zoom Ken Burns (scale 1 → 1.06 selama 8s)
   - gradien 2 lapis: kiri (from-ink via-ink/60) + bawah (from-ink via-ink/70, h-2/3)
   - konten kiri-bawah (p-5, max-w 85%):
       [badge type]  bg-gold text-ink text-10px bold uppercase
       [titleLogo]   max-w 260px h-16 object-contain  (kalau ada)
         ATAU h1 font-display bold text-2xl line-clamp-2
       ⭐ rating (gold, text-xs) + year (silver)
       [▶ Tonton]  bg-gold text-ink rounded-xl px-5 py-2.5 bold
       [ⓘ Detail]  bg-white/10 border-white/20 rounded-xl px-4 py-2.5
   - AUTOPLAY 6000ms; swipe kiri/kanan (>40px, vertikal <60px)

2. LANJUTKAN MENONTON (localStorage mz_continue_watching)
   - hanya muncul kalau ada riwayat
   - judul: "Lanjutkan Menonton" (font-display semibold text-base)
   - kartu w-36 aspect 2/3 + tombol ✕ hapus
   - link: film → /watch/{slug}; series → /watch/{slug}?season=S&episode=E

3. GENRE (marquee berjalan)
   - eyebrow: fa-layer-group + "JELAJAHI KATEGORI" (gold, text-10px extrabold)
   - judul: "Genre"  |  kanan: "Semua ›"
   - chip: rounded-2xl, ikon bulat 24px (warna genre), teks putih
   - animasi marquee (chip digandakan 2x), scroll horizontal otomatis

4. TRENDING MINGGU INI
   - eyebrow: fa-fire + "LAGI RAMAI DITONTON"
   - kartu poster (w-36), "→ /popular"

5. KARTU BESAR (film rating tertinggi yg punya backdrop+overview)
   - aspect 3/2, rounded-2xl
   - badge kiri-atas: ⭐ "PILIHAN EDITOR" (bg-gold text-ink)
   - gradien: bawah (from-ink via-ink/60) + kiri (from-ink/40)
   - konten bawah: badge type (ghost+line), judul, dst

6. SEDANG TAYANG
   - eyebrow: fa-clapperboard + "UPDATE TERBARU"
   - /api/movies/latest?type=all  → "→ /latest"

7. TOP 10 POPULER HARI INI  (kartu BERBEDA!)
   - eyebrow: fa-ranking-star + "PALING DICARI"
   - /api/movies/popular?type=all, ambil 10
   - layout: flex gap-1, tiap item = NOMOR BESAR + poster kecil
   - tanpa tombol "lihat semua"

8. RATING TERTINGGI
   - eyebrow: fa-star + "PILIHAN KRITIKUS"
   - /api/movies/top-rated?type=movie → "→ /top-rated"

9. SEGERA DATANG
   - eyebrow: fa-calendar-days + "AKAN TAYANG"
   - kartu wide + BADGE HITUNG HARI (releaseDate − hari ini)
   - tombol 🔔 pengingat (minta izin notifikasi)
     · "denied" → teks: "Film tersimpan di daftar. Untuk dapat notifikasi..."
     · "unsupported" → "Notifikasi push tidak didukung di browser ini."
```

**Skeleton:** setiap seksi punya versi skeleton (poster abu + 2 baris teks). Hero skeleton: `height 78vw, max 460, min 320`.

---

## 3. KARTU POSTER (komponen utama)

```
w-36 (144px)   ← default "md"    |  "sm" = w-28  |  "lg" = w-44
   ├─ div poster-card rounded-xl overflow-hidden bg-inkl aspect-[2/3]
   │    ├─ img object-cover (hover: scale-105, 300ms)
   │    ├─ gradien bawah: from-black/70 via-transparent
   │    ├─ badge kiri-atas: quality (bg-gold/90 text-ink text-9px bold)   [opsional]
   │    ├─ badge kanan-atas: "SERIES" (bg-inkb/90 text-silver text-9px)   [series saja]
   │    └─ kiri-bawah: ⭐ rating (gold text-10px semibold)
   ├─ judul: text-xs font-medium #E8EDF2 line-clamp-2 (hover → gold)
   └─ tahun: text-10px text-dim
   • kalau poster null → bg-inke + ikon fa-tv (series) / fa-film (movie) text-dim
   • tap: active:scale-[0.96]
```

---

## 4. HEADER & NAVIGASI

**Header (fixed top, h-14, px-4):**
- Logo: kotak 7x7 rounded-lg + `favicon.png`; teks "Movie"+"Zone"(gold) font-display bold text-lg
- Tombol cari: bulat 40x40, bg `rgba(255,255,255,0.12)`, border `rgba(255,255,255,0.09)`, blur(10px), shadow
- Saat scroll: bg → gradient `rgba(8,10,12,0.98) → 0.9` + blur(12px)
- **HILANG di `/search`, `/movie/*`, `/watch/*`**

**Nav bawah (fixed bottom, 5 tab):**

| Ikon | Label | Path |
|---|---|---|
| fa-house | Beranda | `/` |
| fa-magnifying-glass | Cari | `/search` |
| fa-layer-group | Genre | `/genre` |
| fa-fire | Populer | `/popular` |
| fa-circle-info | Info | `/info` |

- container: pill mengambang (justify-center, px-3, paddingBottom safe-area-inset)
- tab aktif: indikator emas

---

## 5. HALAMAN DETAIL (`/movie/{slug}`)

**Urutan seksi (label persis dari kode):**

```
[← Kembali]
  Backdrop/poster besar
  judul + badge type ("SERIES"/"Movie") + ⭐rating + tahun
  [▶ Tonton]  [⭐ Rating]  [🔗 Bagikan]

  • Sinopsis          (teks; fallback: "Sinopsis belum tersedia untuk judul ini.")
  • Sutradara         (khusus film)
  • Status            (Released/Ended/...)
  • Season + Episode  (khusus series — selector season & episode)
  • Pemeran           (castDetailed: foto bulat/rounded + nama + karakter)
  • Video Lainnya     (videoGallery — YouTube iframe)
  • Rekomendasi       (recommendations)
  • Rating tersimpan  (tampil kalau user sudah rating)
  • Bagikan           (sheet)
```

**Sheet Bagikan** (dari kode `3513`):
- Bottom sheet `rounded-t-3xl`, drag-handle (bar 10x1)
- Tombol utama: "Bagikan via Aplikasi Lain" (navigator.share) — bg-gold
- Grid 4 kolom: WhatsApp (#25D366), Telegram (#26A5E4), X (#E8EDF2), Facebook (#1877F2)
  · tiap ikon: kotak 48px rounded-2xl, bg warna + `1A`, border warna + `40`
- Baris salin link: kotak `bg-ghost border-line` + tombol "Salin"/"Tersalin"
- Teks share: `Nonton "{judul}" di MovieZone!`

**Selector Rating:** 5 bintang; kirim bintang×2 (2..10); tap bintang yg sama = hapus (DELETE).

---

## 6. HALAMAN PLAYER (`/watch/{slug}?season=S&episode=E`)

```
┌─ [←]  Judul (truncate)         [🔗] ─┐   (h-14, sticky, border-b)
│  Series: "Season 1 · Episode 1"       │
├───────────────────────────────────────┤
│  IFRAME 16/9 (background #000)        │   ← src = server terpilih
│  allow: fullscreen, autoplay, ...     │
│  referrerPolicy: "no-referrer"        │
├───────────────────────────────────────┤
│  [🔓 Kunci Layar]        [⛶ Horizontal]│   ← kontrol bawah player
├───────────────────────────────────────┤
│  ⚙ Pilih Server                        │
│  3 kolom: [●Server 1⭐][Server 2][Server 3]
│            [Server 4][Server 5][Server 6]
│  · aktif: bg-goldf border-gold/50 text-gold
│  · Server 1 dikasih ⭐
│  ℹ "Jika tidak bisa putar, coba server lain."
├───────────────────────────────────────┤
│  Judul (font-display bold text-lg)     │
│  type(gold) · year · ⭐rating          │
│  Sinopsis (line-clamp-3)               │
│  [ⓘ Lihat detail lengkap]              │
└───────────────────────────────────────┘
```

**Fitur:**
- **Fullscreen**: `requestFullscreen()` + `screen.orientation.lock("landscape")`
- Keluar fullscreen otomatis kalau HP diputar ke portrait
- **Saat fullscreen**: tombol "Kunci Layar" (lock) + "Horizontal"
- Header & info tersembunyi saat fullscreen
- Series: pilih Season & Episode

---

## 7. HALAMAN LAIN

**`/genre`** — input cari genre (h-11 rounded-2xl bg-inke, ikon kiri) + grid 2 kolom kartu genre:
- kartu: `genre-card flex items-center gap-3 p-3.5 rounded-2xl`, gradient `--g1`→`--g2`
- ikon bubble 40px rounded-xl (warna gelap #080A0C) + label semibold
- kosong: `Genre "..." tidak ditemukan`

**`/popular`** — filter (type: movie/tv/semua, genre dropdown, sort) + grid poster
- label: "Film Populer", "Muat lebih banyak", "Semua Genre", "Semua konten sudah ditampilkan", "Coba Lagi"
- endpoint: `/api/movies/discover?type=X&genre=Y&sort=popularity.desc`

**`/search`** — input cari + filter type (all/movie/series)
- label: "Ketik judul film atau series", "Mencari...", "Riwayat", "Hapus semua", "Tidak ada hasil untuk X"
- **riwayat pencarian** disimpan lokal

---

## 8. KOMPONEN & ANIMASI

| Nama | Detail |
|---|---|
| `skeleton` | abu-abu shimmer; poster: `rounded-xl aspect-[2/3]` + 2 baris (h-3 w-4/5, h-2.5 w-2/5) |
| `no-scrollbar` | scroll horizontal tanpa scrollbar |
| `poster-card` | card poster (lihat §3) |
| `genre-chip` | chip marquee home |
| `genre-card` | kartu besar di /genre |
| `genre-icon-dot` | bulat 24px di chip |
| `genre-icon-bubble` | rounded-xl 40px di kartu |
| `heroProgress` | animasi progress bar hero (6s linear) |
| `animate-fade-up` | sheet muncul dari bawah |
| Transisi | `active:scale-[0.96]` (tap), hover poster `scale-105`, opacity 300-500ms |

---

## 9. CATATAN UNTUK APK (Compose)

1. **Warna** → `Color(0xFF080A0C)` (ink), `0xFFF5A623` (gold), `0xFF0F1215` (inkl), `0xFF161B20` (inke), `0xFFA0AAB4` (silver), `0xFF505A65` (dim), `Color.White.copy(alpha=.07f)` (line)
2. **Font** → Inter (body) + Space Grotesk (judul) — bisa download & bundle, atau pakai variable font
3. **Header transparan** yang jadi solid saat scroll → `LazyColumn` scrollState + animated background
4. **Hero autoplay** → `LaunchedEffect` + `delay(6000)` + `animateFloatAsState` untuk progress bar
5. **Marquee genre** → `infiniteRepeatable` animation atau LazyRow + auto-scroll
6. **Player** → WebView (header/nav disembunyikan, fullscreen landscape otomatis)
7. **Continue watching** → DataStore/Room (ganti localStorage)
8. **Guest session** → simpan di DataStore (umur 23 jam)
9. **Top 10** → layout khusus: nomor besar (font-display, outline) + poster kecil
10. **Sheet bagikan** → `ModalBottomSheet` Material3

---

## 10. FILE BUKTI

| File | Isi |
|---|---|
| `/root/lunar/moviezone/api2/style.css` | CSS penuh (palet, animasi, komponen) |
| `/root/lunar/moviezone/api2/pages/page-f900e659a338458e.js` | HOME (hero, kartu, top10, upcoming) |
| `.../pages/page-acb646d39c17c425.js` | DETAIL (rating, share, cast) |
| `.../pages/page-f03cbcbeb9da1d7e.js` | PLAYER (server, fullscreen) |
| `.../pages/layout-0099f79f26fa9c10.js` | HEADER + NAV BAWAH |
| `.../pages/page-a83cc9dba0cf4bdb.js` | GENRE (daftar 26 genre berwarna) |
| `.../pages/page-cddab8c0dab0ebbf.js` | POPULAR (filter) |
| `.../pages/page-8a9b5be78303aa55.js` | SEARCH (riwayat) |
