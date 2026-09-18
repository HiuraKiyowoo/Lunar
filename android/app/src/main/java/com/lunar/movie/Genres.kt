package com.lunar.movie

import androidx.compose.ui.graphics.Color

/**
 * 27 genre Indonesia milik MovieZone (dari /api/movies/genres).
 * Server Lunar mengembalikan {id, name} saja; warna + ikon disimpan di sini
 * supaya tampilan tetap sama walau server tidak mengirimnya.
 * Urutan & warna PERSIS dari kode web MovieZone.
 */
data class Genre(
    val name: String,
    val tmdbId: Int,
    val tmdbIdTv: Int = 0,
    val slug: String,
    val color: Color,
    val color2: Color,
    val icon: String,       // nama ikon ringkas
) {
    /** TMDB id yang dipakai sesuai tipe konten. */
    fun tmdbIdFor(isSeries: Boolean): Int = if (isSeries && tmdbIdTv > 0) tmdbIdTv else tmdbId
}

object LocalGenres {

    private fun g(name: String, tmdb: Int, tv: Int, slug: String, c1: Long, c2: Long, icon: String) =
        Genre(name, tmdb, tv, slug, Color(c1), Color(c2), icon)

    /** 26 genre — PERSIS dari kode web MovieZone. */
    val all: List<Genre> = listOf(
        g("Action", 28, 10759, "action", 0xFFE85D3D, 0xFFFF8A5B, "burst"),
        g("Drama", 18, 18, "drama", 0xFF3D8AE8, 0xFF5BA8FF, "theater"),
        g("Horror", 27, 27, "horror", 0xFF8B3DE8, 0xFFB15BFF, "skull"),
        g("Comedy", 35, 35, "comedy", 0xFFE8C83D, 0xFFFFE45B, "laugh"),
        g("Thriller", 53, 53, "thriller", 0xFF3DE8A8, 0xFF5BFFC4, "pulse"),
        g("Romance", 10749, 10749, "romance", 0xFFE83D8A, 0xFFFF5BA8, "heart"),
        g("Sci-Fi", 878, 10765, "sci-fi", 0xFF3DBBE8, 0xFF5BD4FF, "rocket"),
        g("Animasi", 16, 16, "animasi", 0xFFE8823D, 0xFFFFA65B, "wand"),
        g("Fantasy", 14, 14, "fantasy", 0xFFA03DE8, 0xFFC15BFF, "wizard"),
        g("Crime", 80, 80, "crime", 0xFFC83D3D, 0xFFE85B5B, "cuffs"),
        g("Adventure", 12, 12, "adventure", 0xFF3DE85D, 0xFF5BFF7A, "map"),
        g("Family", 10751, 10751, "family", 0xFFE8E83D, 0xFFF5FF5B, "roof"),
        g("War", 10752, 10752, "war", 0xFF8A8A8A, 0xFFABABAB, "rifle"),
        g("Music", 10402, 10402, "music", 0xFFE83DB8, 0xFFFF5BD4, "music"),
        g("Documentary", 99, 99, "documentary", 0xFF3DE8D8, 0xFF5BFFF0, "clap"),
        g("Mystery", 9648, 9648, "mystery", 0xFF5D3DE8, 0xFF7D5BFF, "search"),
        g("History", 36, 36, "history", 0xFFB8863D, 0xFFD9A75B, "landmark"),
        g("Western", 37, 37, "western", 0xFF8A6A3D, 0xFFAB8B5B, "cowboy"),
        g("Aksi & Petualangan", 0, 10759, "aksi-petualangan", 0xFFE85D6B, 0xFFFF7A8A, "boom"),
        g("Anak-Anak", 0, 10762, "anak-anak", 0xFF3DD8E8, 0xFF5BF0FF, "child"),
        g("Berita", 0, 10763, "berita", 0xFF5D6A7A, 0xFF7D8A9A, "news"),
        g("Reality", 0, 10764, "reality", 0xFFE8983D, 0xFFFFB85B, "video"),
        g("Sci-Fi & Fantasy", 0, 10765, "scifi-fantasy", 0xFF6A3DE8, 0xFF8B5BFF, "meteor"),
        g("Sinetron", 0, 10766, "sinetron", 0xFFE83D5D, 0xFFFF5B7A, "tv"),
        g("Talk Show", 0, 10767, "talk-show", 0xFF3DE87D, 0xFF5BFF9A, "mic"),
        g("Perang & Politik", 0, 10768, "perang-politik", 0xFF7A7A3D, 0xFF9B9B5B, "scale"),
        g("Film TV", 10770, 10770, "film-tv", 0xFF6B7B8C, 0xFF9AAAB8, "tv"),
    )

    /** Nama TMDB Indonesia → nama web MovieZone (server kirim nama Indonesia). */
    private val alias = mapOf(
        "aksi" to "Action", "petualangan" to "Adventure", "animasi" to "Animasi",
        "komedi" to "Comedy", "kejahatan" to "Crime", "dokumenter" to "Documentary",
        "drama" to "Drama", "keluarga" to "Family", "fantasi" to "Fantasy",
        "sejarah" to "History", "kengerian" to "Horror", "musik" to "Music",
        "misteri" to "Mystery", "percintaan" to "Romance", "cerita fiksi" to "Sci-Fi",
        "film tv" to "Film TV", "cerita seru" to "Thriller", "perang" to "War",
        "barat" to "Western", "aksi & petualangan" to "Aksi & Petualangan",
        "anak-anak" to "Anak-Anak",
    )

    /** Cari warna+ikon untuk nama/id genre dari server. */
    fun decorate(name: String, tmdbId: Int): Genre {
        val target = alias[name.lowercase()] ?: name
        return all.firstOrNull { it.tmdbId == tmdbId && tmdbId != 0 }
            ?: all.firstOrNull { it.name.equals(target, true) }
            ?: all.firstOrNull { it.name.equals(name, true) }
            ?: Genre(
                name = name,
                tmdbId = tmdbId,
                slug = name.lowercase().replace(" ", "-"),
                color = Color(0xFF5D6A7A),
                color2 = Color(0xFF7D8A9A),
                icon = "film",
            )
    }
}
