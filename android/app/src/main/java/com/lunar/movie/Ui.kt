package com.lunar.movie

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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

/* ------------------------------------------------------------------ */
/*  Kartu poster 2:3 (persis kartu MovieZone)                          */
/* ------------------------------------------------------------------ */

@Composable
fun PosterCard(
    item: Item,
    width: androidx.compose.ui.unit.Dp = 132.dp,
    showTitle: Boolean = true,
    onClick: () -> Unit = {},
) {
    Column(Modifier.width(width).clickable { onClick() }) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(12.dp))
                .background(T.inke),
        ) {
            AsyncImage(
                model = item.poster ?: item.backdrop,
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // gradien bawah
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.55f to Color.Transparent,
                            1f to Color(0xCC080A0C),
                        )
                    )
            )
            // badge rating (emas)
            if (item.rating.isNotBlank()) {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xE60F1215))
                        .padding(horizontal = 6.dp, vertical = 3.dp),
                ) {
                    Text("★ ${item.rating}", color = T.gold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
            // badge SERIES (biru)
            if (item.isSeries) {
                Box(
                    Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xE63B82F6))
                        .padding(horizontal = 6.dp, vertical = 3.dp),
                ) {
                    Text("SERIES", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                }
            }
            // judul di bawah gambar
            if (showTitle) {
                Text(
                    item.title,
                    color = T.text,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(8.dp),
                )
            }
        }
        if (!showTitle) {
            Text(
                item.title,
                color = T.text,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Judul seksi (ikon + judul + subjudul)                              */
/* ------------------------------------------------------------------ */

@Composable
fun SectionHeader(title: String, subtitle: String? = null, icon: String? = null) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Text(icon, fontSize = 15.sp, modifier = Modifier.padding(end = 6.dp))
        }
        Column {
            Text(title, color = T.text, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            if (subtitle != null) {
                Text(subtitle, color = T.dim, fontSize = 11.sp)
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Shimmer / skeleton (ukurannya SAMA dengan data asli → tak ngeblink) */
/* ------------------------------------------------------------------ */

@Composable
fun shimmerBrush(): Brush {
    val t = rememberInfiniteTransition(label = "shim")
    val x by t.animateFloat(
        initialValue = -500f,
        targetValue = 1000f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing)),
        label = "x",
    )
    return Brush.linearGradient(
        colors = listOf(T.inke, Color(0xFF20262C), T.inke),
        start = androidx.compose.ui.geometry.Offset(x, 0f),
        end = androidx.compose.ui.geometry.Offset(x + 400f, 400f),
    )
}

/** Skeleton kartu poster — dimensi identik dengan PosterCard. */
@Composable
fun SkeletonPoster(width: androidx.compose.ui.unit.Dp = 132.dp, withTitle: Boolean = true) {
    val b = shimmerBrush()
    Column(Modifier.width(width)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(12.dp))
                .background(b),
        )
        if (withTitle) {
            Box(
                Modifier
                    .padding(top = 6.dp)
                    .fillMaxWidth(0.85f)
                    .height(11.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(b),
            )
        }
    }
}

@Composable
fun SkeletonRow(count: Int = 4, width: androidx.compose.ui.unit.Dp = 132.dp) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        userScrollEnabled = false,
    ) {
        items(count) { SkeletonPoster(width) }
    }
}

/* ------------------------------------------------------------------ */
/*  Baris film (judul + LazyRow poster)                                */
/* ------------------------------------------------------------------ */

@Composable
fun PosterRow(
    title: String,
    subtitle: String? = null,
    icon: String? = null,
    items: List<Item>,
    onItem: (Item) -> Unit,
) {
    if (items.isEmpty()) return
    Column(Modifier.padding(vertical = 8.dp)) {
        SectionHeader(title, subtitle, icon)
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            items(items, key = { it.slug + it.title }) { it2 ->
                PosterCard(it2) { onItem(it2) }
            }
        }
    }
}
