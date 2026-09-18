# 🌙 LUNAR

> **An Astralune Project** — Backend + APK untuk katalog & pemutar movie.
>
> Data katalog dari **MovieZone** (`moviezone.web.id`), stream di-resolve lewat
> **VidLink**. Server Lunar yang menggabungkan keduanya, APK cuma jadi UI +
> pemutar (ExoPlayer native — **tanpa WebView**).

---

## 🗺️ Arsitektur

```
┌─────────────────┐   HTTPS    ┌──────────────────────────────┐
│   APK LUNAR     │ ─────────► │  server/  (VPS, Node.js)     │
│  (ExoPlayer)    │            │                              │
│                 │ ◄───────── │  • /api/...   → MovieZone    │
│  • Home/Detail  │            │  • /stream    → token WASM   │
│  • Player       │            │    + kualitas + subtitle     │
└─────────────────┘            │  • /v/<id>    → proxy video  │
        ▲                      │  • /s/<id>    → subtitle VTT │
        │ domain (my.zone.id)  └──────────────────────────────┘
        └──────────────────────────────┘
```

**Kenapa lewat server?**
- APK ringan — WASM 2,4 MB & logika scraping ada di server
- Ganti VPS/domain → cukup ubah **DNS**, APK tak perlu di-update
- Kalau sumber stream berubah → perbaiki server saja

---

## 📁 Isi

| Folder | Isi |
|---|---|
| `server/` | Backend Node.js (WASM token, resolver stream, proxy video/subtitle) |
| `android/` | Project Android Studio (Kotlin + Compose + ExoPlayer) |
| `docs/` | Catatan API & desain |

---

## 🚀 1. Menjalankan Server

### Prasyarat
- **Node.js >= 18** (uji di v22)
- Linux (Ubuntu/Debian disarankan)
- Port `8080` bebas (bisa diganti lewat `PORT`)

### Cara cepat (otomatis)
```bash
cd server
bash deploy/install.sh          # pasang systemd + nginx (kalau ada)
```

### Cara manual
```bash
cd server
node server.js                  # → http://localhost:8080
```
Cek:
```bash
curl http://localhost:8080/health
curl 'http://localhost:8080/stream?tmdb=550&type=movie'
```

### Tes cepat
```bash
# 1. katalog
curl -s 'http://localhost:8080/api/movies/trending' | head -c 400

# 2. genre
curl -s 'http://localhost:8080/api/movies/genres' | head -c 400

# 3. detail (slug movie-550 = Fight Club)
curl -s 'http://localhost:8080/api/movies/detail/movie-550' | head -c 400

# 4. STREAM — yang paling penting
curl -s 'http://localhost:8080/stream?tmdb=550&type=movie'
```
Hasil `/stream` kira-kira:
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
    { "language": "English", "url": "/s/9d2f....vtt" },
    { "language": "Indonesian", "url": "/s/1a3b....vtt" }
  ]
}
```

### Jadikan layanan permanen (systemd)
```bash
sudo cp server/deploy/lunar.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lunar
sudo systemctl status lunar
journalctl -u lunar -f          # lihat log
```

---

## 🌐 2. Menyambungkan ke Domain

Anggap domain: **`lunar.zone.id`** (dari `my.zone.id`), VPS IP `103.x.x.x`.

### a. Arahkan DNS
Di panel `my.zone.id`, buat record:
| Tipe | Nama | Nilai |
|---|---|---|
| A | `lunar` | `103.x.x.x` (IP VPS lu) |

### b. Reverse proxy (Nginx)
```bash
sudo cp server/deploy/nginx.conf /etc/nginx/sites-available/lunar
sudo nano /etc/nginx/sites-available/lunar      # ganti lunar.zone.id → domain lu
sudo ln -sf /etc/nginx/sites-available/lunar /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### c. HTTPS (wajib untuk Android modern)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d lunar.zone.id
```
Certbot mengurus perpanjangan otomatis.

### d. Uji dari luar
```bash
curl 'https://lunar.zone.id/health'
curl 'https://lunar.zone.id/stream?tmdb=550&type=movie'
```

⚠️ **Kalau VPS di belakang NAT** (port di-forward), pastikan:
- Port **80** dan **443** diteruskan ke VPS
- Kalau hanya punya port lain (mis. `18080`), pakai:
  `https://lunar.zone.id:18080` — dan sesuaikan `Api.BASE` di APK

---

## 📱 3. Build APK

### Prasyarat
- Android Studio / Android SDK (compileSdk 35)
- JDK 17

### Build
```bash
cd android
./gradlew assembleDebug        # APK debug
./gradlew assembleRelease      # APK rilis
```
Hasil di:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### ⚠️ Ganti domain server (PENTING)
Semua lalu lintas lewat server Lunar. Ganti **satu** konstanta ini:

`android/app/src/main/java/com/lunar/movie/Api.kt`
```kotlin
object Api {
    /** >>> SATU-SATUNYA yang perlu diganti kalau server/domain pindah <<< */
    var BASE: String = "https://lunar.zone.id"
    ...
}
```

Setelah diganti → build ulang. **Tidak perlu bongkar APK** kalau cuma pindah VPS:
cukup ubah DNS, domain tetap sama.

### R8 / minify
Saat ini **sengaja dimatikan** (`isMinifyEnabled = false`) supaya mudah didebug.
Nyalakan setelah stabil:
`android/app/build.gradle.kts` → `release { isMinifyEnabled = true }`

---

## 🔌 Ringkasan API Server

| Endpoint | Fungsi |
|---|---|
| `GET /health` | Status server, statistik cache |
| `GET /api/movies/hero` | Banner beranda (+`titleLogo`) |
| `GET /api/movies/trending?type=all\|movie\|tv` | Trending |
| `GET /api/movies/popular?type=...` | Populer |
| `GET /api/movies/top-rated?type=movie\|tv` | Rating tertinggi |
| `GET /api/movies/upcoming` | Segera datang |
| `GET /api/movies/latest?type=...` | Update terbaru |
| `GET /api/movies/search?q=` | Cari |
| `GET /api/movies/discover?type=&genre=&page=&sort=&year=` | Filter |
| `GET /api/movies/genres` | 27 genre `{genres:[{id,name}]}` |
| `GET /api/movies/detail/{slug}` | Detail (29 field) |
| `GET /api/movies/episodes/{slug}?season=N` | Episode (`season=0` = semua) |
| `GET /stream?tmdb=&type=&season=&episode=` | **Resolve stream** |
| `GET /v/<id>` | Proxy video (dukung Range) |
| `GET /s/<id>.vtt` | Subtitle (SRT → VTT) |
| `POST /api/session/guest` | Sesi tamu (rating) |
| `POST/DELETE /api/movies/rate/{slug}` | Beri/hapus bintang |

Cache di memori 5 menit (`CACHE_MS`), proxy video 1 jam.

---

## ⚠️ Catatan Penting

- **`server/wasm/fu.wasm`** (2,4 MB) wajib ada — dipakai membuat token VidLink.
  Jangan dihapus meski terlihat "aneh" di repo.
- **CDN video menolak akses langsung** (428/403/429 Cloudflare). Karena itu
  `/v/<id>` **wajib** dipakai — IP VPS yang mengakses CDN, bukan HP.
- Kalau `429` muncul: menandakan IP VPS kelewat sering. Kurangi frekuensi,
  atau tunggu beberapa menit.
- Proyek ini **tidak menyimpan berkas video**; semua media dari pihak ketiga.

---

## 🧰 Pemecahan Masalah

| Gejala | Sebab / Solusi |
|---|---|
| `/health` gagal | server mati → `systemctl restart lunar` |
| `/stream` → `token null` | WASM gagal → cek `node -v` >= 18 & `wasm/fu.wasm` ada |
| `/v/...` → 429 | IP diblokir sementara Cloudflare → tunggu / ganti IP |
| APK kosong | `Api.BASE` salah → tes `curl <BASE>/health` |
| Video tak jalan di APK | `/v/` harus 200 → lihat tabel di atas |
| Subtitle tak muncul | pastikan `/s/....vtt` → 200 |

---

## 📜 Lisensi

Proyek ini hanya untuk pembelajaran. Semua metadata milik TMDB/MovieZone.
Tidak ada berkas video yang disimpan di server aplikasi.
