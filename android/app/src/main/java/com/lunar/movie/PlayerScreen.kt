package com.lunar.movie

import android.app.Activity
import android.content.pm.ActivityInfo
import android.net.Uri
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.dash.DashMediaSource
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.compose.ui.platform.LocalLifecycleOwner

/**
 * Player Lunar — ExoPlayer NATIVE (tanpa WebView).
 *
 * Semua URL sudah lewat server Lunar (/v/... = proxy video, /s/... = subtitle).
 * Kualitas dari server Lunar = mp4 HEVC → bisa diputar langsung.
 */
@Composable
fun PlayerScreen(
    tmdbId: Int,
    type: String,
    season: Int,
    episode: Int,
    title: String,
    onBack: () -> Unit,
) {
    val ctx = LocalContext.current
    val activity = ctx as? Activity

    var stream by remember { mutableStateOf<StreamResult?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var current by remember { mutableStateOf<Quality?>(null) }
    var subtitle by remember { mutableStateOf<Caption?>(null) }
    var serverIdx by remember { mutableIntStateOf(0) }

    // ExoPlayer
    val player = remember {
        ExoPlayer.Builder(ctx).build().apply {
            playWhenReady = true
        }
    }

    // Ambil stream
    LaunchedEffect(tmdbId, type, season, episode, serverIdx) {
        loading = true; error = null
        val s = Api.stream(tmdbId, type, season, episode)
        stream = s
        if (s == null || s.qualities.isEmpty()) {
            error = "Stream tidak tersedia. Coba server lain atau lagi sebentar."
        } else {
            current = s.qualities.last()      // default kualitas tertinggi
            subtitle = s.captions.firstOrNull { it.language.contains("Indonesia", true) }
                ?: s.captions.firstOrNull()
        }
        loading = false
    }

    // Pasang media saat kualitas/ subtitle berubah
    LaunchedEffect(current, subtitle) {
        val q = current ?: return@LaunchedEffect
        val url = Api.absolute(q.url)
        val mi = MediaItem.Builder().setUri(Uri.parse(url)).build()
        player.setMediaItem(mi)
        player.prepare()

        if (subtitle != null) {
            try {
                val sub = MediaItem.SubtitleConfiguration.Builder(Uri.parse(Api.absolute(subtitle!!.url)))
                    .setMimeType(MimeTypes.APPLICATION_SUBRIP)   // server kirim WebVTT
                    .setLanguage(subtitle!!.language)
                    .setSelectionFlags(androidx.media3.common.C.SELECTION_FLAG_DEFAULT)
                    .build()
                player.setMediaItem(
                    MediaItem.Builder().setUri(Uri.parse(url)).setSubtitleConfigurations(listOf(sub)).build()
                )
                player.prepare()
            } catch (e: Exception) { /* subtitle opsional */ }
        }
    }

    DisposableEffect(Unit) {
        onDispose { player.release() }
    }

    // Layar selalu penuh
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    this.player = player
                    useController = true
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        // Overlay: judul + tombol kembali + pengaturan
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).clip(RoundedCornerShape(50)).background(Color(0xAA0F1215))
                .clickable { onBack() }, contentAlignment = Alignment.Center) {
                Text("←", color = Color.White, fontSize = 17.sp)
            }
            Spacer(Modifier.width(10.dp))
            Text(title, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f))
            Box(Modifier.clip(RoundedCornerShape(50)).background(Color(0xAA0F1215)).clickable {
                activity?.requestedOrientation =
                    if (activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)
                        ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }.padding(horizontal = 10.dp, vertical = 5.dp)) {
                Text("⛶", color = Color.White, fontSize = 14.sp)
            }
        }

        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = T.gold)
                    Spacer(Modifier.height(12.dp))
                    Text("Menyiapkan stream…", color = T.silver, fontSize = 12.sp)
                }
            }
        }

        error?.let { msg ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("⚠️", fontSize = 30.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(msg, color = Color.White, fontSize = 13.sp)
                    Spacer(Modifier.height(14.dp))
                    Box(Modifier.clip(RoundedCornerShape(10.dp)).background(T.gold).clickable {
                        serverIdx++
                    }.padding(horizontal = 18.dp, vertical = 9.dp)) {
                        Text("Coba Lagi", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
        }

        // Panel bawah: kualitas + subtitle
        val s = stream
        if (s != null && !loading) {
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .background(Color(0xCC080A0C)).padding(12.dp)
            ) {
                if (s.qualities.size > 1) {
                    Text("Kualitas", color = T.dim, fontSize = 10.sp)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 5.dp)) {
                        items(s.qualities) { q ->
                            val on = q.label == current?.label
                            Box(Modifier.clip(RoundedCornerShape(8.dp))
                                .background(if (on) T.gold else Color(0x33FFFFFF))
                                .clickable { current = q }
                                .padding(horizontal = 12.dp, vertical = 6.dp)) {
                                Text(q.label + (q.sizeText?.let { " · $it" } ?: ""),
                                    color = if (on) Color.Black else Color.White, fontSize = 11.sp,
                                    fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
                            }
                        }
                    }
                }
                if (s.captions.isNotEmpty()) {
                    Text("Subtitle", color = T.dim, fontSize = 10.sp)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 5.dp)) {
                        items(s.captions) { c ->
                            val on = c.language == subtitle?.language
                            Box(Modifier.clip(RoundedCornerShape(8.dp))
                                .background(if (on) T.gold else Color(0x33FFFFFF))
                                .clickable { subtitle = c }
                                .padding(horizontal = 10.dp, vertical = 5.dp)) {
                                Text(c.language, color = if (on) Color.Black else Color.White, fontSize = 10.sp)
                            }
                        }
                        item {
                            Box(Modifier.clip(RoundedCornerShape(8.dp)).background(Color(0x33FFFFFF))
                                .clickable { subtitle = null; player.setMediaItem(
                                    MediaItem.Builder().setUri(Uri.parse(Api.absolute(current?.url ?: ""))).build()
                                ); player.prepare() }
                                .padding(horizontal = 10.dp, vertical = 5.dp)) {
                                Text("Mati", color = Color.White, fontSize = 10.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}
