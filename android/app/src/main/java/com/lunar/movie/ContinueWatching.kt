package com.lunar.movie

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * "Lanjutkan Menonton" — setara localStorage mz_continue_watching di web.
 * Maksimal 20 entri, terbaru di depan.
 */
object ContinueWatching {

    private const val KEY = "mz_continue_watching"
    private const val MAX = 20
    private lateinit var sp: SharedPreferences

    fun init(ctx: Context) {
        if (!::sp.isInitialized) sp = ctx.getSharedPreferences("lunar", Context.MODE_PRIVATE)
    }

    fun list(): List<Item> {
        if (!::sp.isInitialized) return emptyList()
        return try {
            val a = JSONArray(sp.getString(KEY, "[]"))
            (0 until a.length()).mapNotNull { i ->
                val o = a.optJSONObject(i) ?: return@mapNotNull null
                Item(
                    id = 0, slug = o.optString("slug"), tmdbId = o.optInt("tmdbId", o.optInt("id")),
                    title = o.optString("title"), type = o.optString("type", "Movie"),
                    poster = o.optString("poster").ifBlank { null }, backdrop = o.optString("backdrop").ifBlank { null },
                    rating = o.optString("rating"), voteCount = 0, year = o.optString("year"),
                    releaseDate = "", overview = null,
                )
            }
        } catch (e: Exception) { emptyList() }
    }

    fun add(item: Item) {
        if (!::sp.isInitialized) return
        val cur = list().filter { it.slug != item.slug }
        val out = (listOf(item) + cur).take(MAX)
        val a = JSONArray()
        out.forEach { it2 ->
            a.put(JSONObject().apply {
                put("slug", it2.slug); put("tmdbId", it2.tmdbId); put("title", it2.title)
                put("type", it2.type); put("poster", it2.poster ?: ""); put("backdrop", it2.backdrop ?: "")
                put("rating", it2.rating); put("year", it2.year)
                put("lastWatchedAt", System.currentTimeMillis())
            })
        }
        sp.edit().putString(KEY, a.toString()).apply()
    }

    fun remove(slug: String) {
        if (!::sp.isInitialized) return
        val a = JSONArray()
        list().filter { it.slug != slug }.forEach { it2 ->
            a.put(JSONObject().apply { put("slug", it2.slug); put("title", it2.title) })
        }
        sp.edit().putString(KEY, a.toString()).apply()
    }
}
