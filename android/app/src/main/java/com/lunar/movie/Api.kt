package com.lunar.movie

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Client API Lunar.
 *
 * ⚠️ SEMUA permintaan lewat SERVER LUNAR sendiri (bukan langsung MovieZone),
 *    supaya kalau situs/ganti server cukup ganti DNS — APK tak perlu update.
 *
 * Ganti BASE_URL ini kalau domain berubah.
 */
object Api {

    /** >>> SATU-SATUNYA yang perlu diganti kalau server/domain pindah <<< */
    var BASE: String = "https://lunar.zone.id"

    /** Fallback kalau server Lunar belum siap (langsung ke MovieZone). */
    private const val MZ = "https://moviezone.web.id"

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private const val UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

    private suspend fun raw(path: String, method: String = "GET", json: String? = null, useServer: Boolean = true): String =
        withContext(Dispatchers.IO) {
            val base = if (useServer) BASE else MZ
            val b = Request.Builder().url(base + path)
                .header("User-Agent", UA)
                .header("Accept", "application/json, text/plain, */*")
            if (json != null) {
                b.method(method, json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            } else if (method != "GET") {
                b.method(method, ByteArray(0).toRequestBody(null))
            }
            client.newCall(b.build()).execute().use { r -> r.body?.string() ?: "" }
        }

    private suspend fun list(path: String): List<Item> = try {
        JSONObject(raw(path)).optJSONArray("results")?.toItems() ?: emptyList()
    } catch (e: Exception) {
        emptyList()
    }

    // ---------- List (semua via server Lunar) ----------
    suspend fun hero() = list("/api/movies/hero")
    suspend fun trending(type: String = "all") = list("/api/movies/trending?type=$type")
    suspend fun popular(type: String = "all") = list("/api/movies/popular?type=$type")
    suspend fun topRated(type: String = "movie") = list("/api/movies/top-rated?type=$type")
    suspend fun upcoming() = list("/api/movies/upcoming")
    suspend fun latest(type: String = "all") = list("/api/movies/latest?type=$type")
    suspend fun search(q: String) = list("/api/movies/search?q=" + java.net.URLEncoder.encode(q, "UTF-8"))

    suspend fun discover(
        type: String,
        genreTmdbId: Int? = null,
        sort: String = "popularity.desc",
        page: Int = 1,
        year: Int? = null,
    ): List<Item> {
        val sb = StringBuilder("/api/movies/discover?type=$type&sort=$sort&page=$page")
        if (genreTmdbId != null && genreTmdbId > 0) sb.append("&genre=$genreTmdbId")
        if (year != null) sb.append("&year=$year")
        return list(sb.toString())
    }

    /** Genre dari server (format {genres:[{id,name}]}) atau MovieZone. */
    suspend fun genres(): List<Genre> = try {
        val o = JSONObject(raw("/api/movies/genres"))
        val a = o.optJSONArray("genres") ?: o.optJSONArray("results") ?: return LocalGenres.all
        (0 until a.length()).mapNotNull { i ->
            a.optJSONObject(i)?.let { g ->
                val name = g.optString("name", g.optString("label"))
                val tmdb = g.optInt("id", g.optInt("tmdbId"))
                LocalGenres.decorate(name, tmdb)
            }
        }.ifEmpty { LocalGenres.all }
    } catch (e: Exception) {
        LocalGenres.all
    }

    // ---------- Detail ----------
    suspend fun detail(slug: String): Detail? = try {
        val o = JSONObject(raw("/api/movies/detail/$slug"))
        if (o.has("error")) null else parseDetail(o)
    } catch (e: Exception) {
        null
    }

    /** Episode. season 0 = semua musim. */
    suspend fun episodes(slug: String, season: Int = 1): List<Episode> = try {
        parseEpisodes(JSONObject(raw("/api/movies/episodes/$slug?season=$season")))
    } catch (e: Exception) {
        emptyList()
    }

    // ---------- STREAM (lewat server Lunar) ----------
    /**
     * Hasil: {sourceId, type, ttl, qualities:{q:{label,url,sizeText,codec}}, captions:[{language,url}]}
     */
    suspend fun stream(tmdbId: Int, type: String = "movie", season: Int = 0, episode: Int = 0): StreamResult? = try {
        val p = "/stream?tmdb=$tmdbId&type=$type" +
                (if (season > 0) "&season=$season&episode=$episode" else "")
        parseStream(JSONObject(raw(p)))
    } catch (e: Exception) {
        null
    }

    /** URL mutlak untuk /v/... dan /s/... */
    fun absolute(pathOrUrl: String): String =
        if (pathOrUrl.startsWith("http")) pathOrUrl else BASE + pathOrUrl

    // ---------- Rating ----------
    suspend fun guestSession(): String? = try {
        val o = JSONObject(raw("/api/session/guest", "POST", "{}"))
        if (o.optBoolean("success")) o.optString("guestSessionId").ifBlank { null } else null
    } catch (e: Exception) {
        null
    }

    suspend fun rate(slug: String, sessionId: String, stars: Int, season: Int = 0, episode: Int = 0): Boolean = try {
        val sb = StringBuilder("/api/movies/rate/$slug?guestSessionId=$sessionId")
        if (season > 0) sb.append("&season=$season&episode=$episode")
        JSONObject(raw(sb.toString(), "POST", """{"rating":${stars * 2}}""")).optBoolean("success")
    } catch (e: Exception) {
        false
    }

    suspend fun unrate(slug: String, sessionId: String, season: Int = 0, episode: Int = 0): Boolean = try {
        val sb = StringBuilder("/api/movies/rate/$slug?guestSessionId=$sessionId")
        if (season > 0) sb.append("&season=$season&episode=$episode")
        JSONObject(raw(sb.toString(), "DELETE")).optBoolean("success")
    } catch (e: Exception) {
        false
    }
}

/* ------------------------------------------------------------------ */
/*  Model stream (bentuknya dari server Lunar)                        */
/* ------------------------------------------------------------------ */

data class Quality(val label: String, val url: String, val sizeText: String?, val codec: String?)

data class Caption(val language: String, val url: String)

data class StreamResult(
    val sourceId: String?,
    val type: String,
    val ttl: Int,
    val qualities: List<Quality>,
    val captions: List<Caption>,
)

fun parseStream(o: JSONObject): StreamResult {
    val qs = mutableListOf<Quality>()
    // kualitas = objek {"360":{...}} atau array
    o.optJSONObject("qualities")?.let { q ->
        val keys = q.keys().asSequence().toList().sortedBy { it.toIntOrNull() ?: 0 }
        for (k in keys) {
            val v = q.optJSONObject(k) ?: continue
            qs.add(
                Quality(
                    label = v.optString("label", "${k}p"),
                    url = v.optString("url"),
                    sizeText = if (v.isNull("sizeText")) null else v.optString("sizeText"),
                    codec = if (v.isNull("codec")) null else v.optString("codec"),
                )
            )
        }
    }
    val caps = mutableListOf<Caption>()
    o.optJSONArray("captions")?.let { a ->
        for (i in 0 until a.length()) {
            val c = a.optJSONObject(i) ?: continue
            caps.add(Caption(c.optString("language"), c.optString("url")))
        }
    }
    return StreamResult(
        sourceId = if (o.isNull("sourceId")) null else o.optString("sourceId"),
        type = o.optString("type", "file"),
        ttl = o.optInt("ttl", 3600),
        qualities = qs,
        captions = caps,
    )
}
