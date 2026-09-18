# 🌙 Lunar — Backend

> Backend untuk client **Lunar**. Menggabungkan katalog **MovieZone** dengan
> resolver stream **VidLink** (via WebAssembly), lalu menyajikannya sebagai satu
> API JSON yang bersih.

```
Client (APK / web)
      │  HTTPS
      ▼
┌──────────────────────────────────────────┐
│  Lunar Backend (Node.js)                 │
│                                          │
│  /api/movies/*   → proxy + cache MovieZone│
│  /stream         → token WASM + kualitas  │
│                    + subtitle             │
│  /v/<id>         → proxy video (Range)    │
│  /s/<id>.vtt     → subtitle (SRT→VTT)     │
└──────────────────────────────────────────┘
      │
      ▼
   CDN video (dengan header yang benar)
```

---

## ✨ Kenapa perlu backend

- **Token VidLink** dibuat lewat WASM (Go + libsodium, 2,4 MB) — tak praktis
  dijalankan di HP.
- **CDN menolak akses langsung** (428/403/429 Cloudflare). Backend yang
  mengakses CDN, jadi IP server yang dipakai — bukan IP pengguna.
- **Semua media lewat perantara `noon.mooncase.online`.** CDN
  (`bcdn*.hakunaymatata.com`) menolak akses langsung: `428` tanpa Referer,
  `429` dengan Referer. Player VidLink sendiri tidak pernah menyentuh CDN —
  ia memakai perantara:
  ```
  /mp/<path>?sign=&t=&headers=<json>&host=<cdn>    (mp4)
  /sacdn/<path>?host=&sc=<base64 cookie>           (dash/hls)
  ```
  Perantara itulah yang membuat tanda tangan CloudFront (`sc`).
  Algoritmanya disalin di `lunar-vidlink-transform.js` (dari modul webpack 5196).
- **`headers={}` → `428 Forbidden`.** Parameter `headers` pada URL `/mp/` wajib
  berisi sesuatu (mis. `{"Referer":"https://vidlink.pro/"}`). Server mengisinya
  otomatis bila sumber mengirim objek kosong.
- **Satu titik ubah**: kalau sumber stream berubah, cukup perbaiki server.
  Client tidak perlu di-update, cukup arahkan DNS.

---

## 📋 Prasyarat

| Kebutuhan | Versi |
|---|---|
| Node.js | **>= 18** (diuji di v22) |
| OS | Linux (Ubuntu/Debian disarankan) |
| RAM | minimal 256 MB (dipakai ~150 MB) |
| Port | `3000` (bisa diubah lewat `PORT`) |

---

## 🚀 Menjalankan

### Cara cepat
```bash
git clone <repo-ini>.git
cd <repo-ini>
node server.js
```
Server jalan di `http://localhost:3000`.

### Sebagai layanan permanen (systemd)
```bash
sudo cp deploy/lunar.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lunar
sudo systemctl status lunar
journalctl -u lunar -f
```

### Atau otomatis (systemd + nginx)
```bash
sudo bash deploy/install.sh
```

---

## 🧪 Menguji

```bash
# 1. status
curl http://localhost:3000/health
# → {"ok":true,"uptime":..,"cache":{...},"videos":0,"subs":0}

# 2. katalog
curl -s 'http://localhost:3000/api/movies/trending' | head -c 400

# 3. daftar genre (27 genre)
curl -s 'http://localhost:3000/api/movies/genres' | head -c 400

# 4. detail  (movie-550 = Fight Club)
curl -s 'http://localhost:3000/api/movies/detail/movie-550' | head -c 400

# 5. STREAM — inti dari semuanya
curl -s 'http://localhost:3000/stream?tmdb=550&type=movie'
```

Contoh hasil `/stream`:
```json
{
  "sourceId": "mwVault",
  "type": "file",
  "ttl": 3600,
  "qualities": {
    "360": { "label": "360p", "url": "/v/261c7a231a8501604445", "sizeText": "196 MB", "codec": "hevc" },
    "480": { "label": "480p", "url": "/v/ac5979a336ffaf728640", "sizeText": "237 MB", "codec": "hevc" },
    "720": { "label": "720p", "url": "/v/c9856c84997f1a1b406", "sizeText": "483 MB", "codec": "hevc" }
  },
  "captions": [
    { "language": "English",    "url": "/s/9d2f....vtt" },
    { "language": "Indonesian", "url": "/s/1a3b....vtt" }
  ]
}
```

> Untuk serial: `/stream?tmdb=1399&type=tv&season=1&episode=1`

---

## 🌐 Menyambungkan ke Domain

Anggap domain **`lunar.zone.id`** dan IP VPS `103.x.x.x`.

### 1. DNS
| Tipe | Nama | Nilai |
|---|---|---|
| A | `lunar` | `103.x.x.x` |

### 2. Nginx (reverse proxy)
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/lunar
sudo nano /etc/nginx/sites-available/lunar     # ganti lunar.zone.id → domainmu
sudo ln -sf /etc/nginx/sites-available/lunar /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 3. HTTPS (wajib)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d lunar.zone.id
```

### 4. Uji dari luar
```bash
curl https://lunar.zone.id/health
curl 'https://lunar.zone.id/stream?tmdb=550&type=movie'
```

> **Di belakang NAT?** Pastikan port **80** & **443** diteruskan.
> Karena port yang di-mapping adalah **3000**, arahkan port **3000** (dan 80/443 kalau ada)
> ke VPS. Kalau mapping-mu hanya 3000 dan tanpa 443, pakai `https://lunar.zone.id:3000`.

---

## 🔌 Daftar Endpoint

| Endpoint | Keterangan |
|---|---|
| `GET /health` | Status server, statistik cache |
| `GET /api/movies/hero` | Banner beranda (ada field `titleLogo`) |
| `GET /api/movies/trending?type=all\|movie\|tv` | Trending |
| `GET /api/movies/popular?type=...` | Populer |
| `GET /api/movies/top-rated?type=movie\|tv` | Rating tertinggi |
| `GET /api/movies/upcoming` | Segera datang |
| `GET /api/movies/latest?type=...` | Update terbaru |
| `GET /api/movies/search?q=` | Pencarian |
| `GET /api/movies/discover?type=&genre=&page=&sort=&year=` | Filter lanjutan |
| `GET /api/movies/genres` | 27 genre → `{genres:[{id,name}]}` |
| `GET /api/movies/detail/{slug}` | Detail (29 field: cast, seasons, rekomendasi, dll) |
| `GET /api/movies/episodes/{slug}?season=N` | Episode (`season=0` = semua musim) |
| `GET /stream?tmdb=&type=&season=&episode=` | **Resolve stream** |
| `GET /v/<id>` | Proxy video (mendukung Range/seek) |
| `GET /s/<id>.vtt` | Subtitle (SRT dikonversi ke WebVTT) |
| `POST /api/session/guest` | Sesi tamu (untuk rating) |
| `POST /api/movies/rate/{slug}?guestSessionId=` | Beri bintang |
| `DELETE /api/movies/rate/{slug}?guestSessionId=` | Hapus bintang |

**Cache**: katalog 5 menit (`CACHE_MS`), proxy video 1 jam.
**CORS**: `Access-Control-Allow-Origin: *` (siap dipakai client mana pun).

---

## ⚙️ Variabel Lingkungan

| Nama | Default | Fungsi |
|---|---|---|
| `PORT` | `3000` | Port server |
| `CACHE_MS` | `300000` | Umur cache katalog (ms) |

---

## 📁 Struktur

```
.
├── server.js         # router utama (API, stream, proxy)
├── lunar-wasm.js     # menjalankan WASM VidLink → token getAdv()
├── lunar-cdn.js      # proxy video + subtitle (Range, retry, SRT→VTT)
├── wasm/
│   ├── fu.wasm           # WASM (Go) 2,4 MB — WAJIB, jangan dihapus
│   ├── libsodium.js      # modul enkripsi
│   └── script.js         # loader Emscripten
├── chunks/           # modul bundle yang dibutuhkan WASM (20 berkas)
├── deploy/
│   ├── lunar.service # unit systemd
│   ├── nginx.conf    # contoh reverse proxy
│   └── install.sh    # pemasang otomatis
└── package.json
```

---

## ⚠️ Catatan Penting

- **`wasm/fu.wasm` (2,4 MB) wajib ada.** Tanpa berkas ini `/stream` gagal
  (`token null`). Jangan dihapus meski terlihat asing.
- **`/v/<id>` wajib dipakai** — CDN video menolak akses langsung (428/403/429).
- **Muncul `429`?** Halaman nginx `429 Too Many Requests` (587 byte) berarti
  **alamat/IP terlalu sering mengakses** — tunggu beberapa menit. Ini bukan
  tanda header salah: header salah memberi `428` (14 byte).
- Server ini **tidak menyimpan berkas video**; semua media dari pihak ketiga.

---

## 🧰 Pemecahan Masalah

| Gejala | Penyebab / Solusi |
|---|---|
| `/health` gagal | server mati → `systemctl restart lunar` |
| `/stream` → `token null` | WASM gagal → cek `node -v` ≥ 18 dan `wasm/fu.wasm` ada |
| `/stream` → `stream tidak tersedia` | id TMDB salah / judul tak ada di sumber |
| `/v/...` → 429 | Referer/Origin tidak cocok dengan `_raw...qualities[].headers` → pastikan server meneruskan header dari respons |
| `/v/...` → 403/428 | Referer kosong → sumber tidak mengirim header; pakai fallback `https://vidlink.pro/` |
| `/s/....vtt` → 404 | URL subtitle kedaluwarsa → minta `/stream` lagi |
| Server tak bisa diakses dari luar | cek firewall (ufw) & forwarding port |

---

## 📜 Catatan Hukum

Proyek ini hanya untuk pembelajaran. Metadata milik TMDB/MovieZone.
**Tidak ada berkas video yang disimpan** di server ini — semua media
disalurkan dari pihak ketiga.
