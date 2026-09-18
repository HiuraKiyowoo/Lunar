package com.lunar.movie

import org.json.JSONArray
import org.json.JSONObject

/** Satu judul (film / series) dari list endpoint. */
data class Item(
    val id: Int,
    val slug: String,
    val tmdbId: Int,
    val title: String,
    val type: String,
    val poster: String?,
    val backdrop: String?,
    val rating: String,
    val voteCount: Int,
    val year: String,
    val releaseDate: String,
    val overview: String?,
    val titleLogo: String? = null,
) {
    val isSeries: Boolean get() = type.equals("Series", true)
}

fun JSONObject.toItem(): Item = Item(
    id = optInt("id"),
    slug = optString("slug"),
    tmdbId = optInt("tmdbId", optInt("id")),
    title = optString("title"),
    type = optString("type", "Movie"),
    poster = optString("poster").ifBlank { null },
    backdrop = optString("backdrop").ifBlank { null },
    rating = optString("rating"),
    voteCount = optInt("voteCount"),
    year = optString("year"),
    releaseDate = optString("releaseDate"),
    overview = if (isNull("overview")) null else optString("overview"),
    titleLogo = if (isNull("titleLogo")) null else optString("titleLogo").ifBlank { null },
)

fun JSONArray.toItems(): List<Item> = (0 until length()).mapNotNull {
    optJSONObject(it)?.toItem()
}

/** Detail lengkap. */
data class Cast(val name: String, val character: String, val photo: String?)
data class Season(val number: Int, val name: String, val episodes: Int, val poster: String?)
data class Server(val server: String, val url: String)

data class Detail(
    val slug: String,
    val title: String,
    val type: String,
    val poster: String?,
    val backdrop: String?,
    val rating: String,
    val year: String,
    val releaseDate: String,
    val synopsis: String?,
    val duration: String?,
    val status: String,
    val genres: List<String>,
    val director: String?,
    val cast: List<Cast>,
    val imdbId: String?,
    val ageRating: String?,
    val numberOfSeasons: Int,
    val numberOfEpisodes: Int,
    val seasons: List<Season>,
    val recommendations: List<Item>,
    val servers: List<Server>,
    val keywords: List<String>,
    val providers: List<Pair<String, String>>,
) {
    val isSeries: Boolean get() = type.equals("Series", true)
}

fun parseDetail(o: JSONObject): Detail {
    val cast = mutableListOf<Cast>()
    o.optJSONArray("castDetailed")?.let { a ->
        for (i in 0 until a.length()) {
            val c = a.optJSONObject(i) ?: continue
            cast.add(
                Cast(
                    name = c.optString("name"),
                    character = c.optString("character"),
                    photo = c.optString("photo").ifBlank { null },
                )
            )
        }
    }
    val seasons = mutableListOf<Season>()
    o.optJSONArray("seasons")?.let { a ->
        for (i in 0 until a.length()) {
            val s = a.optJSONObject(i) ?: continue
            seasons.add(
                Season(
                    number = s.optInt("season_number"),
                    name = s.optString("name"),
                    episodes = s.optInt("episode_count"),
                    poster = s.optString("poster_path").ifBlank { null }?.let { "https://image.tmdb.org/t/p/w300$it" },
                )
            )
        }
    }
    val servers = mutableListOf<Server>()
    o.optJSONObject("stream")?.optJSONArray("servers")?.let { a ->
        for (i in 0 until a.length()) {
            val s = a.optJSONObject(i) ?: continue
            servers.add(Server(s.optString("server"), s.optString("url")))
        }
    }
    val recs = mutableListOf<Item>()
    o.optJSONArray("recommendations")?.let { a ->
        for (i in 0 until a.length()) {
            val r = a.optJSONObject(i) ?: continue
            recs.add(
                Item(
                    id = 0, slug = r.optString("slug"), tmdbId = 0,
                    title = r.optString("title"), type = r.optString("type", "Movie"),
                    poster = r.optString("poster").ifBlank { null },
                    backdrop = null, rating = r.optString("rating"), voteCount = 0,
                    year = r.optString("year"), releaseDate = "", overview = null,
                )
            )
        }
    }
    val provs = mutableListOf<Pair<String, String>>()
    o.optJSONArray("watchProviders")?.let { a ->
        for (i in 0 until a.length()) {
            val p = a.optJSONObject(i) ?: continue
            provs.add(p.optString("name") to p.optString("logo"))
        }
    }
    val kws = mutableListOf<String>()
    o.optJSONArray("keywords")?.let { a -> for (i in 0 until a.length()) kws.add(a.optString(i)) }
    val gs = mutableListOf<String>()
    o.optJSONArray("genres")?.let { a -> for (i in 0 until a.length()) gs.add(a.optString(i)) }

    return Detail(
        slug = o.optString("slug"),
        title = o.optString("title"),
        type = o.optString("type", "Movie"),
        poster = o.optString("poster").ifBlank { null },
        backdrop = o.optString("backdrop").ifBlank { null },
        rating = o.optString("rating"),
        year = o.optString("year"),
        releaseDate = o.optString("releaseDate"),
        synopsis = if (o.isNull("synopsis")) null else o.optString("synopsis"),
        duration = if (o.isNull("duration")) null else o.optString("duration"),
        status = o.optString("status"),
        genres = gs,
        director = if (o.isNull("director")) null else o.optString("director"),
        cast = cast,
        imdbId = if (o.isNull("imdbId")) null else o.optString("imdbId"),
        ageRating = if (o.isNull("ageRating")) null else o.optString("ageRating"),
        numberOfSeasons = o.optInt("numberOfSeasons"),
        numberOfEpisodes = o.optInt("numberOfEpisodes"),
        seasons = seasons,
        recommendations = recs,
        servers = servers,
        keywords = kws,
        providers = provs,
    )
}

/** Satu episode. */
data class Episode(
    val episode: Int,
    val season: Int,
    val title: String,
    val overview: String?,
    val still: String?,
    val airDate: String,
    val runtime: String?,
    val servers: List<Server>,
)

fun parseEpisodes(o: JSONObject): List<Episode> {
    val out = mutableListOf<Episode>()
    o.optJSONArray("episodes")?.let { a ->
        for (i in 0 until a.length()) {
            val e = a.optJSONObject(i) ?: continue
            val srv = mutableListOf<Server>()
            e.optJSONArray("servers")?.let { sa ->
                for (j in 0 until sa.length()) {
                    val s = sa.optJSONObject(j) ?: continue
                    srv.add(Server(s.optString("server"), s.optString("url")))
                }
            }
            out.add(
                Episode(
                    episode = e.optInt("episode"),
                    season = e.optInt("season"),
                    title = e.optString("title"),
                    overview = if (e.isNull("overview")) null else e.optString("overview").ifBlank { null },
                    still = if (e.isNull("still")) null else e.optString("still").ifBlank { null },
                    airDate = e.optString("airDate"),
                    runtime = if (e.isNull("runtime")) null else e.optString("runtime"),
                    servers = srv,
                )
            )
        }
    }
    return out
}
