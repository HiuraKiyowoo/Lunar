# 📡 API MovieZone — Dokumentasi LENGKAP & DETAIL

**Base URL:** `https://moviezone.web.id`
**Sumber:** reverse-engineered dari chunk JS (`app/(main)/*/page-*.js`)
**Auth:** ❌ TIDAK ADA (semua GET publik). Rating pakai guest session.
**Cloudflare:** aktif — perlu `User-Agent` browser. Rate-limit ada (jangan spam).

---

## 1. DAFTAR ENDPOINT

| # | Method | Endpoint | Fungsi |
|---|---|---|---|
| 1 | GET | `/api/movies/hero` | Banner hero (punya `titleLogo`) |
| 2 | GET | `/api/movies/trending` | Trending (`?type=movie\|tv\|all`) |
| 3 | GET | `/api/movies/popular` | Populer (`?type=movie\|tv\|all`, `?page=`) |
| 4 | GET | `/api/movies/top-rated` | Rating tertinggi (`?type=`, `?page=`) |
| 5 | GET | `/api/movies/upcoming` | Akan tayang |
| 6 | GET | `/api/movies/latest` | Terbaru (`?type=all` → 40 item) |
| 7 | GET | `/api/movies/discover` | Filter lanjutan |
| 8 | GET | `/api/movies/search` | Cari (`?q=`) |
| 9 | GET | `/api/movies/genres` | 27 genre (label Indonesia) |
| 10 | GET | `/api/movies/detail/{slug}` | Detail lengkap (film/series) |
| 11 | GET | `/api/movies/episodes/{slug}` | Daftar episode (`?season=N`, `0`=semua) |
| 12 | POST | `/api/session/guest` | Buat guest session |
| 13 | POST | `/api/movies/rate/{slug}?guestSessionId=..&season=..&episode=..` | Kirim rating |
| 14 | DELETE | `/api/movies/rate/{slug}?guestSessionId=..&season=..&episode=..` | Hapus rating |

**Slug format:** `movie-{tmdbId}` atau `tv-{tmdbId}` (contoh: `movie-550`, `tv-1399`)

---

## 2. BENTUK ITEM KARTU (semua list endpoint)

```json
{
  "id": 1101383,
  "slug": "movie-1101383",
  "tmdbId": 1101383,
  "title": "The End of Oak Street",
  "type": "Movie",              // "Movie" | "Series"
  "poster": "https://image.tmdb.org/t/p/w500/nlC0I1cCemzfNLYPnAhdydpOYOi.jpg",
  "backdrop": "https://image.tmdb.org/t/p/w780/b9q9VmbXDvJmTziRqkwdEmFdwhr.jpg",
  "rating": "6.9",              // STRING desimal
  "voteCount": 1029,
  "year": "2026",               // STRING
  "releaseDate": "2026-08-12",
  "overview": null,             // sering null di list
  "genreIds": [878, 9648, 53]
}
```

**Wrapper respons:** `{ "results": [...], "total_pages": N, "total_results": M? }`
> `total_pages` = 500 (trending), 1001 (popular?type=all → 40.002 judul)

**Ekstra di `/hero`:**
```json
{ "titleLogo": "https://image.tmdb.org/t/p/w500/8VDfGY16827yyWH0R8itxLtfgK1.png" }
```
> `titleLogo` = logo judul transparan (PNG). Tidak ada di endpoint lain.

---

## 3. PARAMETER YANG BENAR-BENAR BEKERJA (terverifikasi)

| Endpoint | Parameter valid | Catatan |
|---|---|---|
| trending/popular/top-rated/latest/upcoming | `type=movie\|tv\|all` | `latest?type=all` → 40 item |
| popular, top-rated, latest, discover, search | `page=N` | |
| discover | `genre=<tmdbId>` | `with_genres`/`genres` **DIIABAIKAN** |
| discover | `type=movie\|tv` | |
| discover | `sort=popularity.desc` / `vote_average.desc` | |
| discover | `year=2024` | |
| episodes | `season=N` | **`season=0` → semua musim (300 eps!)** |
| search | `q=<teks>` | |

---

## 4. DETAIL — 29 FIELD LENGKAP

```json
{
  "id": 550,
  "slug": "movie-550",
  "type": "Movie",                      // "Movie" | "Series"
  "title": "Fight Club",
  "poster": ".../w500/jSziioSwPVrOy9Yow3XhWIBDjq1.jpg",
  "backdrop": ".../w780/c6OLXfKAk5BKeR6broC8pYiCquX.jpg",
  "rating": "8.4",
  "voteCount": 32861,
  "year": "1999",
  "releaseDate": "1999-10-15",
  "synopsis": "Seorang pekerja kantoran yang menderita insomnia...",
  "tagline": null,
  "duration": "139 menit",              // FILM saja, null di series
  "status": "Released",                 // Released | Ended | planned | in production
  "genres": ["Drama", "Cerita Seru"],   // array STRING (nama Indonesia)
  "director": "David Fincher",          // null di series
  "cast": ["Edward Norton", "Brad Pitt", ...],       // 24 nama
  "castDetailed": [                     // 24 objek
    { "id": 819, "name": "Edward Norton", "character": "Narrator",
      "photo": ".../w185/8nytsqL59SFJTVYVrN72k6qkGgJ.jpg" }
  ],
  "trailer": null,                      // kadang {key/name} (YouTube)
  "imdbId": "tt0137523",
  "numberOfSeasons": null,              // series: 8
  "numberOfEpisodes": null,             // series: 73
  "seasons": [                          // SERIES saja
    { "air_date": "2011-04-17", "episode_count": 10, "id": 3624,
      "name": "Musim ke 1", "overview": "", "poster_path": "/wgfKiq..jpg",
      "season_number": 1, "vote_average": 8.4 }
  ],
  "ageRating": "13+",                   // atau "D", "R", dll
  "watchProviders": [                   // provider streaming legal
    { "id": 8, "name": "Netflix", "logo": ".../w185/rK1KljqmbvO9HQa1PBFLILWah72.png" }
  ],
  "recommendations": [                  // 12 rekomendasi (bentuk item kartu ringkas)
    { "slug": "movie-641", "title": "Requiem for a Dream",
      "poster": "...", "year": "2000", "rating": "8.0", "type": "Movie" }
  ],
  "videoGallery": [],                   // kadang berisi video YouTube
  "keywords": ["dual identity", "support group", ...],
  "stream": {
    "primaryIframe": "https://vidsrc.wiki/embed/movie/550",
    "servers": [
      { "server": "VidSrcWiki", "url": "https://vidsrc.wiki/embed/movie/550" },
      { "server": "SuperEmbed", "url": "https://multiembed.mov/?video_id=550&tmdb=1" },
      { "server": "VidSrc",     "url": "https://vidsrc.to/embed/movie/550" },
      { "server": "VidLink",    "url": "https://vidlink.pro/movie/550" },
      { "server": "2Embed",     "url": "https://www.2embed.cc/embed/550" },
      { "server": "VSEmbed",    "url": "https://vsembed.ru/embed/movie/tt0137523" },
      { "server": "VidSrc",     "url": "..." }     // 6-7 server
    ]
  }
}
```

**Catatan:** `stream.servers[]` juga **dibangun ulang di client** (lihat §7), jadi bisa dipakai walau field hilang.

---

## 5. EPISODE — 8 FIELD

`GET /api/movies/episodes/{slug}?season=N`

```json
{
  "episodes": [
    {
      "episode": 1,
      "season": 1,
      "title": "Episode 1",
      "overview": "Jon Arryn, the Hand of the King, is dead...",
      "still": "https://image.tmdb.org/t/p/w185/o4IX9Mm0kpLITVANJMx7inyEUaY.jpg",
      "airDate": "2011-04-17",
      "runtime": "62 menit",
      "servers": [ {"server": "VidSrcWiki", "url": "https://vidsrc.wiki/embed/tv/1399/1/1"}, ... ]
    }
  ]
}
```
- `?season=0` → **SEMUA musim** (tv-1399 → 300 episode, termasuk specials season 0)
- Sekali request = 1 musim. Bisa juga minta semua.

---

## 6. GENRE — 27 item (label Indonesia + warna + ikon)

`GET /api/movies/genres` → `{"genres":[{"id":28,"name":"Aksi"},...]}`

**Daftar visual lengkap (dari chunk JS) — dipakai untuk chip & kartu genre:**

| label | slug | color | color2 | icon | tmdbId | tmdbIdTv |
|---|---|---|---|---|---|---|
| Action | action | #E85D3D | #FF8A5B | fa-burst | 28 | 10759 |
| Drama | drama | #3D8AE8 | #5BA8FF | fa-masks-theater | 18 | 18 |
| Horror | horror | #8B3DE8 | #B15BFF | fa-skull | 27 | |
| Comedy | comedy | #E8C83D | #FFE45B | fa-face-laugh | 35 | 35 |
| Thriller | thriller | #3DE8A8 | #5BFFC4 | fa-heart-pulse | 53 | |
| Romance | romance | #E83D8A | #FF5BA8 | fa-heart | 10749 | |
| Sci-Fi | sci-fi | #3DBBE8 | #5BD4FF | fa-rocket | 878 | 10765 |
| Animasi | animasi | #E8823D | #FFA65B | fa-wand-magic-sparkles | 16 | 16 |
| Fantasy | fantasy | #A03DE8 | #C15BFF | fa-hat-wizard | 14 | |
| Crime | crime | #C83D3D | #E85B5B | fa-handcuffs | 80 | 80 |
| Adventure | adventure | #3DE85D | #5BFF7A | fa-map-location-dot | 12 | |
| Family | family | #E8E83D | #F5FF5B | fa-people-roof | 10751 | |
| War | war | #8A8A8A | #ABABAB | fa-person-military-rifle | 10752 | |
| Music | music | #E83DB8 | #FF5BD4 | fa-music | 10402 | |
| Documentary | documentary | #3DE8D8 | #5BFFF0 | fa-clapperboard | 99 | 99 |
| Mystery | mystery | #5D3DE8 | #7D5BFF | fa-magnifying-glass | 9648 | 9648 |
| History | history | #B8863D | #D9A75B | fa-landmark | 36 | |
| Western | western | #8A6A3D | #AB8B5B | fa-hat-cowboy | 37 | 37 |
| Aksi & Petualangan | aksi-petualangan | #E85D6B | #FF7A8A | fa-explosion | | 10759 |
| Anak-Anak | anak-anak | #3DD8E8 | #5BF0FF | fa-child-reaching | | 10762 |
| Berita | berita | #5D6A7A | #7D8A9A | fa-newspaper | | 10763 |
| Reality | reality | #E8983D | #FFB85B | fa-video | | 10764 |
| Sci-Fi & Fantasy | scifi-fantasy | #6A3DE8 | #8B5BFF | fa-meteor | | 10765 |
| Sinetron | sinetron | #E83D5D | #FF5B7A | fa-tv | | 10766 |
| Talk Show | talk-show | #3DE87D | #5BFF9A | fa-microphone-lines | | 10767 |
| Perang & Politik | perang-politik | #7A7A3D | #9B9B5B | fa-scale-balanced | | 10768 |

> Halaman `/genre/{slug}` ada (SPA fallback); data diambil via `discover?genre={tmdbId}&type={movie\|tv}`

---

## 7. RATING (guest session)

```js
// 1) Guest session (localStorage "mz_guest_session", umur ±23 jam)
POST /api/session/guest                    (body kosong)
→ { "success": true, "guestSessionId": "...", "expiresAt": "2026-09-19 03:56:00 UTC" }

// 2) Kirim rating (bintang 1–5 → dikirim ×2 = 2,4,6,8,10)
POST /api/movies/rate/{slug}?guestSessionId={sid}&season={S}&episode={E}
  Content-Type: application/json
  body: {"rating": 8}
→ { "success": true }

// 3) Hapus rating
DELETE /api/movies/rate/{slug}?guestSessionId={sid}&season={S}&episode={E}
→ { "success": true }

// 4) Simpan lokal: localStorage "mz_guest_ratings" = {"{slug}": bintang}
//    key film: "movie-550"  |  key episode: "tv-1399:s1e1"
```
> `season` & `episode` hanya untuk series. Rating film cukup slug.

---

## 8. STREAM (CARA PUTAR)

`stream.servers[]` (atau dibangun client) berisi 6 server embed. Client (chunk watch) membangunnya begini:

```js
// FILM
[
 {server:"VidSrcWiki", url:`https://vidsrc.wiki/embed/movie/${id}`},
 {server:"SuperEmbed", url:`https://multiembed.mov/?video_id=${id}&tmdb=1`},
 {server:"VidSrc",     url:`https://vidsrc.to/embed/movie/${id}`},
 {server:"VidLink",    url:`https://vidlink.pro/movie/${id}`},          // ⭐ TERBAIK
 {server:"2Embed",     url:`https://www.2embed.cc/embed/${id}`},
 {server:"VSEmbed",    url:`https://vsembed.ru/embed/movie/${imdbId||id}`},
]
// SERIES  (id, season S, episode E)
[
 {server:"VidSrcWiki", url:`https://vidsrc.wiki/embed/tv/${id}/${S}/${E}`},
 {server:"SuperEmbed", url:`https://multiembed.mov/?video_id=${id}&tmdb=1&s=${S}&e=${E}`},
 {server:"VidSrc",     url:`https://vidsrc.to/embed/tv/${id}/${S}/${E}`},
 {server:"VidLink",    url:`https://vidlink.pro/tv/${id}/${S}/${E}`},   // ⭐
 {server:"2Embed",     url:`https://www.2embed.cc/embedtv/${id}&s=${S}&e=${E}`},
 {server:"VSEmbed",    url:`https://vsembed.ru/embed/tv/${imdbId||id}/${S}/${E}`},
]
```

**Server 1 (VidSrcWiki) diberi bintang ⭐ di UI** ("Jika tidak bisa putar, coba server lain.")

### VidLink — stream LANGSUNG (hasil tembus, lihat STREAM-TEMBUS.md)
WebView `vidlink.pro/movie/{id}` = **pasti jalan** (player urus token+cookie sendiri).
Native: butuh WASM `getAdv(id)` → `/api/b/movie/{token}` → cookie CloudFront → DASH.

---

## 9. URL HALAMAN (web)

| Path | Keterangan |
|---|---|
| `/` | Home |
| `/search` | Cari (dengan riwayat) |
| `/genre` | Daftar genre (search internal) |
| `/genre/{slug}` | Film per genre |
| `/popular` | Populer (filter: type, genre, sort) |
| `/top-rated` | Rating tertinggi |
| `/latest` | Terbaru |
| `/info` | Info app |
| `/movie/{slug}` | **Detail** |
| `/watch/{slug}` | **Player** (`?season=N&episode=N`) |

> `/watch/tv-1399/1/1` → 404. **Bentuk benar: `/watch/tv-1399?season=1&episode=1`**

---

## 10. localStorage keys (fitur client)

| Key | Isi |
|---|---|
| `mz_continue_watching` | array max 20: `{slug,title,poster,type,year,rating,season,episode,lastWatchedAt}` |
| `mz_guest_session` | `{guestSessionId, createdAt, expiresAt}` |
| `mz_guest_ratings` | `{"slug" atau "slug:s1e1": bintang}` |

> Fungsi: `a()` ambil continue-watching (urut `lastWatchedAt` desc), `l(slug)` hapus 1, `o()` catat saat nonton.

---

## 11. CONTOH CEPAT (curl)

```bash
UA="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36"
B=https://moviezone.web.id

curl -s -A "$UA" "$B/api/movies/hero"
curl -s -A "$UA" "$B/api/movies/trending?type=all"
curl -s -A "$UA" "$B/api/movies/popular?type=movie&page=2"
curl -s -A "$UA" "$B/api/movies/discover?genre=16&type=tv&sort=popularity.desc&page=1"
curl -s -A "$UA" "$B/api/movies/search?q=avengers"
curl -s -A "$UA" "$B/api/movies/genres"
curl -s -A "$UA" "$B/api/movies/detail/movie-550"
curl -s -A "$UA" "$B/api/movies/episodes/tv-1399?season=0"
curl -s -A "$UA" -X POST "$B/api/session/guest"
curl -s -A "$UA" -X POST -H "Content-Type: application/json" \
     -d '{"rating":8}' "$B/api/movies/rate/movie-550?guestSessionId=SID"
```

---

## 12. FILE BUKTI (di `/root/lunar/moviezone/api2/`)

| File | Isi |
|---|---|
| `hero.json` | contoh hero |
| `trending2.json` | contoh list |
| `detail2.json` | detail film lengkap |
| `detail-tv-1399.json` | detail series |
| `eps2.json` / `episodes-tv-1399.json` | episode |
| `genres2.json` | 27 genre |
| `style.css` | CSS tema (Tailwind) |
| `pages/*.js` | chunk halaman (logika UI) |
| `*.html` | HTML tiap halaman |
