package com.lunar.movie

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.navigation.NavController

@Composable
fun HomeScreen(onItem: (Item) -> Unit, onGenre: (Genre) -> Unit, nav: NavController) {
    var hero by remember { mutableStateOf<List<Item>?>(null) }
    var trending by remember { mutableStateOf<List<Item>?>(null) }
    var editor by remember { mutableStateOf<List<Item>?>(null) }
    var latest by remember { mutableStateOf<List<Item>?>(null) }
    var top10 by remember { mutableStateOf<List<Item>?>(null) }
    var topRated by remember { mutableStateOf<List<Item>?>(null) }
    var upcoming by remember { mutableStateOf<List<Item>?>(null) }
    var genres by remember { mutableStateOf<List<Genre>>(LocalGenres.all) }
    val cont by remember { mutableStateOf<List<Item>>(ContinueWatching.list()) }

    LaunchedEffect(Unit) {
        Api.hero().let { hero = it }
        Api.genres().let { if (it.isNotEmpty()) genres = it }
        Api.trending().let { trending = it }
        Api.popular().let { p -> editor = p; top10 = p }
        Api.latest("all").let { latest = it }
        Api.topRated("movie").let { topRated = it }
        Api.upcoming().let { upcoming = it }
    }

    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
            // 1. Hero carousel
            item {
                when (val h = hero) {
                    null -> SkeletonHero()
                    else -> if (h.isNotEmpty()) HeroCarousel(h, onItem)
                }
            }

            // 2. Lanjutkan Menonton
            if (cont.isNotEmpty()) {
                item {
                    PosterRow("Lanjutkan Menonton", "Terakhir ditonton", "⏱", cont, onItem)
                }
            }

            // 3. Genre marquee
            item {
                Column(Modifier.padding(vertical = 10.dp)) {
                    SectionHeader("Jelajahi Genre", "39 kategori pilihan", "🎭")
                    GenreMarquee(genres, onGenre)
                }
            }

            // 4. Trending
            item {
                if (trending == null) { SectionHeader("Lagi Ramai Ditonton", "Trending minggu ini", "🔥"); SkeletonRow() }
                else PosterRow("Lagi Ramai Ditonton", "Trending minggu ini", "🔥", trending!!, onItem)
            }

            // 5. Kartu besar "Pilihan Editor"
            item {
                if (editor != null && editor!!.size >= 3) BigCardRow("Pilihan Editor", editor!!.take(6), onItem)
            }

            // 6. Sedang Tayang
            item {
                if (latest == null) { SectionHeader("Update Terbaru", "Sedang tayang", "🎬"); SkeletonRow() }
                else PosterRow("Update Terbaru", "Sedang tayang", "🎬", latest!!, onItem)
            }

            // 7. Top 10
            item {
                if (top10 == null) { SectionHeader("Paling Dicari", "Top 10 hari ini", "🏆"); SkeletonRow(160.dp) }
                else Top10Row("Paling Dicari", top10!!.take(10), onItem)
            }

            // 8. Rating tertinggi
            item {
                if (topRated == null) { SectionHeader("Pilihan Kritikus", "Rating tertinggi", "⭐"); SkeletonRow() }
                else PosterRow("Pilihan Kritikus", "Rating tertinggi", "⭐", topRated!!, onItem)
            }

            // 9. Segera datang
            item {
                if (upcoming == null) { SectionHeader("Segera Datang", "Akan tayang", "📅"); SkeletonRow(220.dp) }
                else UpcomingRow("Segera Datang", upcoming!!, onItem)
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Hero carousel — progress bar di atas, autoplay 6s, zoom Ken Burns  */
/* ------------------------------------------------------------------ */

@Composable
fun HeroCarousel(items: List<Item>, onItem: (Item) -> Unit) {
    val pager = rememberPagerState(pageCount = { items.size })
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        while (true) {
            delay(6000)
            if (!pager.isScrollInProgress) {
                scope.launch { pager.animateScrollToPage((pager.currentPage + 1) % items.size) }
            }
        }
    }

    Box(Modifier.fillMaxWidth().height(480.dp)) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            val it = items[page]
            Box(Modifier.fillMaxSize().clickable { onItem(it) }) {
                // zoom Ken Burns 8s
                val scale = remember { Animatable(1f) }
                LaunchedEffect(page) {
                    scale.snapTo(1f)
                    scale.animateTo(1.08f, tween(8000, easing = LinearEasing))
                }
                AsyncImage(
                    model = it.backdrop ?: it.poster,
                    contentDescription = it.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().graphicsLayer2(scale.value),
                )
                // gradien bawah + kiri
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                    0f to Color(0xAA080A0C), 0.35f to Color(0x66080A0C), 1f to T.ink)))
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(
                    0f to Color(0x99080A0C), 0.6f to Color.Transparent)))

                Column(Modifier.align(Alignment.BottomStart).padding(20.dp).fillMaxWidth(0.85f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Badge(if (it.isSeries) "SERIES" else "FILM", if (it.isSeries) T.blue else T.gold, Color.Black)
                        if (it.rating.isNotBlank()) {
                            Spacer(Modifier.width(6.dp))
                            Badge("★ ${it.rating}", Color(0xCC0F1215), T.gold)
                        }
                        if (it.year.isNotBlank()) {
                            Spacer(Modifier.width(6.dp))
                            Text(it.year, color = T.silver, fontSize = 11.sp)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(it.title, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 30.sp)
                    if (!it.overview.isNullOrBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(it.overview, color = T.silver, fontSize = 12.sp, maxLines = 2,
                            overflow = TextOverflow.Ellipsis, lineHeight = 17.sp)
                    }
                    Spacer(Modifier.height(12.dp))
                    Row {
                        Box(Modifier.clip(RoundedCornerShape(10.dp)).background(T.gold)
                            .clickable { onItem(it) }.padding(horizontal = 18.dp, vertical = 9.dp)) {
                            Text("▶  Tonton", color = Color.Black, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(8.dp))
                        Box(Modifier.clip(RoundedCornerShape(10.dp)).background(Color(0x33FFFFFF))
                            .clickable { onItem(it) }.padding(horizontal = 16.dp, vertical = 9.dp)) {
                            Text("＋ Daftar", color = Color.White, fontSize = 13.sp)
                        }
                    }
                }
            }
        }

        // progress bar di ATAS
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)
            .align(Alignment.TopCenter), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            items.forEachIndexed { i, _ ->
                val active = i == pager.currentPage
                Box(Modifier.weight(1f).height(3.dp).clip(RoundedCornerShape(2.dp))
                    .background(if (active) T.gold else Color(0x44FFFFFF)))
            }
        }

        // dots
        Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            items.forEachIndexed { i, _ ->
                Box(Modifier.size(if (i == pager.currentPage) 7.dp else 5.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (i == pager.currentPage) T.gold else Color(0x66FFFFFF)))
            }
        }
    }
}

@Composable
fun Badge(text: String, bg: Color, fg: Color) {
    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(bg).padding(horizontal = 7.dp, vertical = 3.dp)) {
        Text(text, color = fg, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SkeletonHero() {
    val b = shimmerBrush()
    Box(Modifier.fillMaxWidth().height(480.dp).background(b))
}

/** graphicsLayer kecil biar tidak perlu import berat. */
fun Modifier.graphicsLayer2(scale: Float) = this.then(
    androidx.compose.ui.graphics.graphicsLayer(scaleX = scale, scaleY = scale)
)

/* ------------------------------------------------------------------ */
/*  Genre marquee (chip berwarna)                                     */
/* ------------------------------------------------------------------ */

@Composable
fun GenreMarquee(genres: List<Genre>, onGenre: (Genre) -> Unit) {
    val state = rememberLazyListState()
    LazyRow(
        state = state,
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(top = 8.dp),
    ) {
        items(genres, key = { it.slug + it.name }) { g ->
            Row(
                Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(Brush.horizontalGradient(listOf(g.color, g.color2)))
                    .clickable { onGenre(g) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(genreEmoji(g.icon), fontSize = 12.sp)
                Spacer(Modifier.width(6.dp))
                Text(g.name, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** Ikon ringkas → emoji (biar tak perlu aset font-awesome). */
fun genreEmoji(icon: String): String = when (icon) {
    "burst", "boom" -> "💥"
    "theater" -> "🎭"
    "skull" -> "💀"
    "laugh" -> "😂"
    "pulse" -> "💓"
    "heart" -> "❤️"
    "rocket", "meteor" -> "🚀"
    "wand", "wizard" -> "🪄"
    "cuffs" -> "🚔"
    "map" -> "🗺️"
    "roof", "child" -> "👨‍👩‍👧"
    "rifle", "scale" -> "⚔️"
    "music", "mic" -> "🎵"
    "clap" -> "🎬"
    "search" -> "🔍"
    "landmark" -> "🏛️"
    "cowboy" -> "🤠"
    "news" -> "📰"
    "video" -> "📺"
    "tv" -> "📺"
    else -> "🎞️"
}

/* ------------------------------------------------------------------ */
/*  Kartu besar 3:2 "Pilihan Editor"                                   */
/* ------------------------------------------------------------------ */

@Composable
fun BigCardRow(title: String, items: List<Item>, onItem: (Item) -> Unit) {
    Column(Modifier.padding(vertical = 8.dp)) {
        SectionHeader(title, "Pilihan Editor", "✨")
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            items(items, key = { it.slug + "big" }) { it ->
                Box(
                    Modifier
                        .width(260.dp)
                        .aspectRatio(3f / 2f)
                        .clip(RoundedCornerShape(14.dp))
                        .background(T.inke)
                        .clickable { onItem(it) },
                ) {
                    AsyncImage(it.backdrop ?: it.poster, it.title, contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                        0.4f to Color.Transparent, 1f to Color(0xE6080A0C))))
                    Row(Modifier.align(Alignment.TopStart).padding(10.dp)) {
                        Badge("Pilihan Editor", T.gold, Color.Black)
                    }
                    Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
                        Text(it.title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("★ ${it.rating}", color = T.gold, fontSize = 11.sp)
                            Text("  ·  ${it.year}", color = T.silver, fontSize = 11.sp)
                            if (it.isSeries) { Spacer(Modifier.width(6.dp)); Badge("SERIES", T.blue, Color.White) }
                        }
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Top 10 (nomor besar + poster kecil)                                */
/* ------------------------------------------------------------------ */

@Composable
fun Top10Row(title: String, items: List<Item>, onItem: (Item) -> Unit) {
    Column(Modifier.padding(vertical = 8.dp)) {
        SectionHeader(title, "Top 10 hari ini", "🏆")
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            items(items.size) { i ->
                val it = items[i]
                Row(Modifier.clickable { onItem(it) }, verticalAlignment = Alignment.Bottom) {
                    Text("${i + 1}", color = Color(0x33FFFFFF), fontSize = 76.sp,
                        fontWeight = FontWeight.Black, lineHeight = 76.sp,
                        modifier = Modifier.padding(end = 0.dp))
                    Box(Modifier.width(96.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp))
                        .background(T.inke)) {
                        AsyncImage(it.poster, it.title, contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize())
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Segera datang (kartu lanskap + badge countdown)                     */
/* ------------------------------------------------------------------ */

@Composable
fun UpcomingRow(title: String, items: List<Item>, onItem: (Item) -> Unit) {
    Column(Modifier.padding(vertical = 8.dp)) {
        SectionHeader(title, "Akan tayang", "📅")
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            items(items, key = { it.slug + "up" }) { it ->
                Column(Modifier.width(200.dp).clickable { onItem(it) }) {
                    Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp))
                        .background(T.inke)) {
                        AsyncImage(it.backdrop ?: it.poster, it.title, contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize())
                        daysUntil(it.releaseDate)?.let { d ->
                            Box(Modifier.align(Alignment.TopStart).padding(8.dp)
                                .clip(RoundedCornerShape(6.dp)).background(Color(0xE61F2937))
                                .padding(horizontal = 7.dp, vertical = 3.dp)) {
                                Text(if (d > 0) "$d hari lagi" else "Hari ini", color = Color.White, fontSize = 10.sp)
                            }
                        }
                        Box(Modifier.align(Alignment.BottomEnd).padding(8.dp).size(28.dp)
                            .clip(RoundedCornerShape(50)).background(Color(0xCC0F1215)),
                            contentAlignment = Alignment.Center) {
                            Text("🔔", fontSize = 13.sp)
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(it.title, color = T.text, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(it.releaseDate.ifBlank { it.year }, color = T.dim, fontSize = 10.sp)
                }
            }
        }
    }
}

/** Hitung hari menuju tanggal rilis ISO (yyyy-MM-dd). */
fun daysUntil(iso: String): Int? = try {
    val d = java.time.LocalDate.parse(iso)
    java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.now(), d).toInt()
} catch (e: Exception) {
    null
}
