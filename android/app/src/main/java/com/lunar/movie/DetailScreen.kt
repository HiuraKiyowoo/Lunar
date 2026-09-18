package com.lunar.movie

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
fun DetailScreen(
    slug: String,
    onBack: () -> Unit,
    onPlay: (Detail, Int, Int, Int, String) -> Unit,
    onItem: (Item) -> Unit,
) {
    var d by remember { mutableStateOf<Detail?>(null) }
    var eps by remember { mutableStateOf<List<Episode>>(emptyList()) }
    var season by remember { mutableIntStateOf(1) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(slug) {
        loading = true
        val det = Api.detail(slug)
        d = det
        if (det != null && det.isSeries) {
            val s = if (det.numberOfSeasons > 0) 1 else 0
            season = s
            eps = Api.episodes(slug, s)
        }
        loading = false
    }

    LaunchedEffect(season, slug) {
        if (d?.isSeries == true) eps = Api.episodes(slug, season)
    }

    val det = d
    Box(Modifier.fillMaxSize().background(T.ink)) {
        if (loading || det == null) {
            DetailSkeleton(onBack)
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
                // Backdrop + judul
                item { DetailHero(det, onBack, onPlay) }

                // Info bar (durasi, status, tahun)
                item { InfoBar(det) }

                // Genre chips
                if (det.genres.isNotEmpty()) item { GenreChips(det.genres) }

                // Sinopsis
                if (!det.synopsis.isNullOrBlank()) {
                    item {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Text("Sinopsis", color = T.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(6.dp))
                            Text(det.synopsis!!, color = T.silver, fontSize = 13.sp, lineHeight = 20.sp)
                        }
                    }
                }

                // Episode (kalau series)
                if (det.isSeries && eps.isNotEmpty()) {
                    item { SeasonPicker(det, season) { season = it } }
                    item {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Text("Episode (${eps.size})", color = T.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(8.dp))
                            eps.forEach { e ->
                                EpisodeItem(e) {
                                    onPlay(det, det.slug.toTmdbId(), e.season, e.episode, "${det.title} - S${e.season}E${e.episode}")
                                }
                            }
                        }
                    }
                }

                // Pemain
                if (det.cast.isNotEmpty()) {
                    item {
                        Column(Modifier.padding(vertical = 8.dp)) {
                            SectionHeader("Pemain", "${det.cast.size} orang", "🎭")
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = 16.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.padding(top = 8.dp),
                            ) {
                                items(det.cast) { c ->
                                    Column(Modifier.width(80.dp)) {
                                        AsyncImage(c.photo, c.name, contentScale = ContentScale.Crop,
                                            modifier = Modifier.size(80.dp).clip(RoundedCornerShape(50)).background(T.inke))
                                        Spacer(Modifier.height(5.dp))
                                        Text(c.name, color = T.text, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        if (c.character.isNotBlank())
                                            Text(c.character, color = T.dim, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }
                }

                // Rekomendasi
                if (det.recommendations.isNotEmpty()) {
                    item { PosterRow("Rekomendasi Serupa", "Mungkin kamu suka", "💡", det.recommendations, onItem) }
                }
            }
        }
    }
}

@Composable
fun DetailHero(d: Detail, onBack: () -> Unit, onPlay: (Detail, Int, Int, Int, String) -> Unit) {
    Box(Modifier.fillMaxWidth().height(420.dp)) {
        AsyncImage(d.backdrop ?: d.poster, d.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
            0f to Color(0x99080A0C), 0.4f to Color(0x44080A0C), 1f to T.ink)))
        // tombol kembali
        Box(Modifier.align(Alignment.TopStart).padding(12.dp).size(36.dp)
            .clip(RoundedCornerShape(50)).background(Color(0xCC0F1215)).clickable { onBack() },
            contentAlignment = Alignment.Center) { Text("←", color = Color.White, fontSize = 18.sp) }

        Row(Modifier.align(Alignment.BottomStart).padding(16.dp), verticalAlignment = Alignment.Bottom) {
            Box(Modifier.width(100.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp)).background(T.inke)) {
                AsyncImage(d.poster, d.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(d.title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 24.sp)
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (d.rating.isNotBlank()) { Badge("★ ${d.rating}", Color(0xCC0F1215), T.gold); Spacer(Modifier.width(6.dp)) }
                    Badge(if (d.isSeries) "SERIES" else "FILM", if (d.isSeries) T.blue else T.gold, Color.Black)
                    if (d.year.isNotBlank()) { Spacer(Modifier.width(6.dp)); Text(d.year, color = T.silver, fontSize = 11.sp) }
                }
                Spacer(Modifier.height(12.dp))
                Box(Modifier.clip(RoundedCornerShape(10.dp)).background(T.gold)
                    .clickable {
                        val tmdb = d.slug.toTmdbId()
                        onPlay(d, tmdb, if (d.isSeries) 1 else 0, if (d.isSeries) 1 else 0, d.title)
                    }
                    .padding(horizontal = 20.dp, vertical = 10.dp)) {
                    Text("▶  Tonton Sekarang", color = Color.Black, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun InfoBar(d: Detail) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        if (!d.duration.isNullOrBlank()) Info("Durasi", d.duration!!)
        if (d.status.isNotBlank()) Info("Status", d.status)
        if (d.ageRating != null) Info("Umur", d.ageRating!!)
        if (d.numberOfSeasons > 0) Info("Musim", "${d.numberOfSeasons}")
        if (d.numberOfEpisodes > 0) Info("Episode", "${d.numberOfEpisodes}")
    }
}

@Composable
fun Info(label: String, value: String) {
    Column {
        Text(label, color = T.dim, fontSize = 10.sp)
        Text(value, color = T.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
fun GenreChips(gs: List<String>) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(gs) { g ->
            Box(Modifier.clip(RoundedCornerShape(20.dp)).background(T.ghost).padding(horizontal = 12.dp, vertical = 6.dp)) {
                Text(g, color = T.silver, fontSize = 11.sp)
            }
        }
    }
}

@Composable
fun SeasonPicker(d: Detail, current: Int, onPick: (Int) -> Unit) {
    val n = if (d.numberOfSeasons > 0) d.numberOfSeasons else 1
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items((1..n).toList()) { s ->
            val on = s == current
            Box(Modifier.clip(RoundedCornerShape(20.dp))
                .background(if (on) T.gold else T.ghost)
                .clickable { onPick(s) }
                .padding(horizontal = 14.dp, vertical = 7.dp)) {
                Text("Musim $s", color = if (on) Color.Black else T.silver, fontSize = 12.sp,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
            }
        }
    }
}

@Composable
fun EpisodeItem(e: Episode, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(12.dp))
            .background(T.inkl).clickable { onClick() }.padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(112.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)).background(T.inke)) {
            AsyncImage(e.still, e.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Color(0x33000000)), contentAlignment = Alignment.Center) {
                Text("▶", color = Color.White, fontSize = 16.sp)
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("E${e.episode} · ${e.title}", color = T.text, fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!e.overview.isNullOrBlank())
                Text(e.overview, color = T.dim, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row {
                if (e.airDate.isNotBlank()) Text(e.airDate, color = T.dim, fontSize = 10.sp)
                if (!e.runtime.isNullOrBlank()) Text("  ·  ${e.runtime}", color = T.dim, fontSize = 10.sp)
            }
        }
        Text("${e.servers.size} server", color = T.gold, fontSize = 9.sp)
    }
}

@Composable
fun DetailSkeleton(onBack: () -> Unit) {
    val b = shimmerBrush()
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().height(420.dp).background(b))
        Spacer(Modifier.height(16.dp))
        repeat(4) {
            Box(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth(0.7f)
                .height(14.dp).clip(RoundedCornerShape(5.dp)).background(b))
        }
    }
}

/** "movie-550" → 550 ; "tv-1399" → 1399 */
fun String.toTmdbId(): Int = substringAfterLast('-').toIntOrNull() ?: 0
