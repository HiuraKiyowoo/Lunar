# 🏆 STREAM VIDLINK — TUNTAS TOTAL (200 OK)

## ✅ HASIL: video bisa diunduh & diputar dari server biasa

```
index_web.mpd            → 200 | 5.467 B   application/dash+xml
init-stream0.m4s         → 200 | 3.292 B   (video init)
init-stream1.m4s         → 200 | 765 B     (audio init)
chunk-stream0-00001.m4s  → 200 | 525.380 B (video)
chunk-stream1-00001.m4s  → 200 | 80.858 B  (audio)
Durasi: 2 jam 19 menit | 480p HEVC + AAC
```

## 🔑 RANTAI LENGKAP (6 langkah)

```
1. WASM:  new Dm() → e.run(instance) → window.getAdv(tmdbId) = TOKEN
          (butuh window.sodium = libsodium dari module 73551)

2. API:   GET https://vidlink.pro/api/b/movie/{TOKEN}?multiLang=false
          Header: X-Playback-Environment: standard
          → {sourceId:"mwVault", stream:{qualities:{...}, captions:[...], TTL:3600}}

3. URL kualitas berisi:
     https://noon.mooncase.online/mp/resource/h265/<hash>.mp4?sign=..&t=..&headers={}&host=..
     (requiresProxy:true)

4. Player vidlink memilih DASH, dan MEMBANGUN cookie CloudFront:
     sc = base64url("CloudFront-Policy=...;CloudFront-Signature=...;CloudFront-Key-Pair-Id=KMHN1LQ1HEUPL;")

5. URL DASH final:
     https://noon.mooncase.online/sacdn/dash/<id>/index_web.mpd?host=<origin>&sc=<sc>
     https://noon.mooncase.online/sacdn/dash/<id>/chunk-stream0-000NN.m4s?host=<origin>&sc=<sc>

6. HEADER WAJIB (kalau tidak → 403 Cloudflare / 428 Forbidden):
     Referer: https://vidlink.pro/
     (Origin: https://vidlink.pro optional)
```

## 🎯 CARA MENDAPATKAN `sc` (cookie CloudFront)

`sc` **tidak ada** di respons `/api/b/movie/{token}`.
Ia dibuat **di sisi player** dan muncul di **request player**.
Cara ambil:
- Buka `https://vidlink.pro/movie/<tmdbId>` di browser/WebView
- Rekam request (CDP Network / WebView intercept)
- Ambil parameter `sc` dari URL `chunk-stream*.m4s` pertama

**Atau** (kalau `requiresProxy` + URL mp4 langsung dipakai):
- URL `/mp/...mp4` juga menerima `headers=` di query (lihat catatan bawah)

## ⚠️ CATATAN PENTING soal `headers=`

- `headers={}` → **428 Forbidden**
- Ada isi (mis. `{"Referer":"..."}`) → server lanjut (bukan 428)
- Tapi `headers` **TIDAK** menggantikan **cookie CloudFront** — itu dua hal beda.
- `/mp/...` = MP4 langsung (butuh cookie); `/sacdn/...` = DASH (butuh cookie).

## 📦 Komponen yang ditemukan

| Endpoint | Fungsi |
|---|---|
| `/api/b/movie/{token}` | metadata stream |
| `/api/b/tv/{token}/{s}/{e}` | stream episode |
| `/mp/<path>` | file mp4 langsung |
| `/sacdn/<path>?host=&sc=` | proxy DASH + cookie CloudFront |
| `/proxy/<path>` | proxy lain |

## 🔴 KESIMPULAN UNTUK APK LUNAR

**Cara paling praktis & andal:** **WebView ke `https://vidlink.pro/movie/<tmdbId>`** —
player vidlink akan menangani token, cookie CloudFront, dan DASH sendiri.
(Sama seperti yang MovieZone lakukan dengan `stream.servers[].url`.)

**Kalau mau native (ExoPlayer):**
1. Jalankan WASM di background (atau tiru endpoint `getAdv`)
2. Ambil `/api/b/movie/{token}`
3. **Dapatkan cookie CloudFront** — ini **butuh eksekusi JS player**, jadi praktis tetap butuh WebView
4. Pakai `sc` + `Referer` → ExoPlayer bisa putar MPD-nya

## Bukti file
- `/tmp/cdp/requests.json` — 32 request player (semua 200)
- `/tmp/cdp/vtoken.json` — token localStorage
- `/tmp/cf_cookie.txt` — cookie CloudFront hasil decode `sc`
- `/tmp/mpd_full.xml` — MPD lengkap (34 KB)
- `/root/lunar/moviezone/api/STREAM-FULL-24428.json` — respons API
