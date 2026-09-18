package com.lunar.movie

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.delay

/* ================================================================== */
/*  Cari                                                              */
/* ================================================================== */

@Composable
fun SearchScreen(onItem: (Item) -> Unit, nav: NavController) {
    var q by remember { mutableStateOf("") }
    var res by remember { mutableStateOf<List<Item>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var searched by remember { mutableStateOf(false) }

    LaunchedEffect(q) {
        if (q.length < 2) { res = emptyList(); searched = false; return@LaunchedEffect }
        delay(400)
        busy = true
        res = Api.search(q)
        busy = false
        searched = true
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Text("Cari", color = T.text, fontSize = 22.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 10.dp))

        // kotak pencarian
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(12.dp))
                .background(T.inkl).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("🔍", fontSize = 14.sp)
            Spacer(Modifier.width(10.dp))
            Box(Modifier.weight(1f)) {
                if (q.isEmpty()) Text("Cari film atau series…", color = T.dim, fontSize = 13.sp)
                BasicTextField(
                    value = q, onValueChange = { q = it },
                    textStyle = TextStyle(color = T.text, fontSize = 13.sp),
                    cursorBrush = SolidColor(T.gold),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (q.isNotEmpty()) Text("✕", color = T.dim, fontSize = 13.sp,
                modifier = Modifier.clickable { q = "" })
        }

        Spacer(Modifier.height(8.dp))

        when {
            busy -> SkeletonGrid()
            res.isNotEmpty() -> ResultGrid(res, onItem)
            searched -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("🎬", fontSize = 32.sp)
                    Spacer(Modifier.height(8.dp))
                    Text("Tidak ada hasil untuk \"$q\"", color = T.dim, fontSize = 13.sp)
                }
            }
            else -> PopularHint(onItem)   // sebelum nyari: tampilkan saran
        }
    }
}

@Composable
fun ResultGrid(items: List<Item>, onItem: (Item) -> Unit) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 100.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(items, key = { it.slug + it.title }) { it ->
            PosterCard(it, width = 200.dp, showTitle = false) { onItem(it) }
        }
    }
}

@Composable
fun SkeletonGrid() {
    val b = shimmerBrush()
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 100.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        userScrollEnabled = false,
    ) {
        items(9) {
            Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(b))
        }
    }
}

@Composable
fun PopularHint(onItem: (Item) -> Unit) {
    var pop by remember { mutableStateOf<List<Item>?>(null) }
    LaunchedEffect(Unit) { pop = Api.popular() }
    Column {
        SectionHeader("Populer Sekarang", "Mulai dari sini", "🔥")
        when (val p = pop) {
            null -> SkeletonRow()
            else -> LazyRow(contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
                items(p) { PosterCard(it) { onItem(it) } }
            }
        }
    }
}

/* ================================================================== */
/*  Daftar Genre                                                      */
/* ================================================================== */

@Composable
fun GenreListScreen(onGenre: (Genre) -> Unit, nav: NavController) {
    var gs by remember { mutableStateOf<List<Genre>>(LocalGenres.all) }
    LaunchedEffect(Unit) { Api.genres().let { if (it.isNotEmpty()) gs = it } }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Text("Genre", color = T.text, fontSize = 22.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 10.dp))
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 100.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(gs, key = { it.slug + it.name }) { g ->
                Row(
                    Modifier.fillMaxWidth().height(66.dp).clip(RoundedCornerShape(14.dp))
                        .background(Brush.horizontalGradient(listOf(g.color, g.color2)))
                        .clickable { onGenre(g) }.padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(genreEmoji(g.icon), fontSize = 20.sp)
                    Spacer(Modifier.width(10.dp))
                    Text(g.name, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/* ================================================================== */
/*  Genre (isi)                                                       */
/* ================================================================== */

@Composable
fun GenreScreen(slug: String, onItem: (Item) -> Unit, nav: NavController) {
    val g = LocalGenres.all.firstOrNull { it.slug == slug || it.name.equals(slug, true) }
    var type by remember { mutableStateOf("movie") }
    var items by remember { mutableStateOf<List<Item>?>(null) }
    var page by remember { mutableIntStateOf(1) }

    LaunchedEffect(slug, type) {
        items = null; page = 1
        items = Api.discover(type, g?.tmdbIdFor(type == "tv") ?: 0, page = 1)
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(32.dp).clip(RoundedCornerShape(50)).background(T.ghost)
                .clickable { nav.popBackStack() }, contentAlignment = Alignment.Center) {
                Text("←", color = T.text, fontSize = 16.sp)
            }
            Spacer(Modifier.width(10.dp))
            Text(g?.name ?: slug, color = T.text, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f))
            Toggle(type) { type = it }
        }
        when (val it = items) {
            null -> SkeletonGrid()
            else -> ResultGrid(it, onItem)
        }
    }
}

@Composable
fun Toggle(value: String, onChange: (String) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(20.dp)).background(T.inkl).padding(3.dp)) {
        listOf("movie" to "Film", "tv" to "Series").forEach { (k, label) ->
            val on = value == k
            Box(Modifier.clip(RoundedCornerShape(18.dp))
                .background(if (on) T.gold else Color.Transparent)
                .clickable { onChange(k) }.padding(horizontal = 12.dp, vertical = 6.dp)) {
                Text(label, color = if (on) Color.Black else T.silver, fontSize = 11.sp,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
            }
        }
    }
}

/* ================================================================== */
/*  Populer                                                           */
/* ================================================================== */

@Composable
fun PopularScreen(onItem: (Item) -> Unit, nav: NavController) {
    var type by remember { mutableStateOf("all") }
    var items by remember { mutableStateOf<List<Item>?>(null) }

    LaunchedEffect(type) { items = null; items = Api.popular(type) }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text("Populer", color = T.text, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f))
            Toggle3(type) { type = it }
        }
        when (val it = items) {
            null -> SkeletonGrid()
            else -> ResultGrid(it, onItem)
        }
    }
}

@Composable
fun Toggle3(value: String, onChange: (String) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(20.dp)).background(T.inkl).padding(3.dp)) {
        listOf("all" to "Semua", "movie" to "Film", "tv" to "Series").forEach { (k, label) ->
            val on = value == k
            Box(Modifier.clip(RoundedCornerShape(18.dp))
                .background(if (on) T.gold else Color.Transparent)
                .clickable { onChange(k) }.padding(horizontal = 11.dp, vertical = 6.dp)) {
                Text(label, color = if (on) Color.Black else T.silver, fontSize = 11.sp,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
            }
        }
    }
}

/* ================================================================== */
/*  Info                                                              */
/* ================================================================== */

@Composable
fun InfoScreen(nav: NavController) {
    var health by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        health = try {
            val r = okhttp3.OkHttpClient().newCall(
                okhttp3.Request.Builder().url(Api.BASE + "/health").build()
            ).execute().use { it.body?.string() ?: "" }
        } catch (e: Exception) { "tidak bisa hubungi server: ${e.message}" }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState())
        .padding(20.dp)) {
        Text("Lunar", color = T.gold, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text("com.lunar.movie", color = T.dim, fontSize = 12.sp)
        Spacer(Modifier.height(20.dp))

        InfoCard("Server", Api.BASE)
        Spacer(Modifier.height(10.dp))
        InfoCard("Status Server", health ?: "memeriksa…")
        Spacer(Modifier.height(10.dp))
        InfoCard("Sumber Data", "MovieZone")
        Spacer(Modifier.height(10.dp))
        InfoCard("Pemutar", "ExoPlayer (native)")

        Spacer(Modifier.height(20.dp))
        Text("Catatan", color = T.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(
            "Aplikasi ini hanya menampilkan tautan yang tersedia publik. " +
            "Semua video disalurkan dari pihak ketiga; aplikasi tidak menyimpan berkas video apa pun.",
            color = T.dim, fontSize = 12.sp, lineHeight = 18.sp,
        )
        Spacer(Modifier.height(24.dp))
        Text("Ganti server/domain cukup lewat satu konstanta Api.BASE — tanpa bongkar APK.",
            color = T.dim, fontSize = 11.sp)
    }
}

@Composable
fun InfoCard(label: String, value: String) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(T.inkl).padding(14.dp)) {
        Text(label, color = T.dim, fontSize = 10.sp)
        Spacer(Modifier.height(3.dp))
        Text(value, color = T.text, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

private fun Modifier.verticalScroll(s: androidx.compose.foundation.ScrollState) =
    this.then(androidx.compose.foundation.verticalScroll(s))
