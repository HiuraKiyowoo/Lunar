package com.lunar.movie

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.navigation.compose.currentBackStackEntryAsState

/**
 * Nav bawah 5 tab — PERSIS web MovieZone.
 * Hilang di halaman detail & player.
 */
data class Tab(val route: String, val label: String, val icon: String)

val TABS = listOf(
    Tab("home", "Beranda", "🏠"),
    Tab("search", "Cari", "🔍"),
    Tab("genres", "Genre", "🗂"),
    Tab("popular", "Populer", "🔥"),
    Tab("info", "Info", "ℹ"),
)

@Composable
fun BottomNav(nav: NavController) {
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: "home"

    // sembunyikan di detail & player
    if (route.startsWith("detail") || route.startsWith("play")) return

    Box(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Color(0xF20F1215))
                .navigationBarsPadding()
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            TABS.forEach { t ->
                val on = route == t.route || (t.route == "genres" && route.startsWith("genre"))
                Column(
                    Modifier.clip(RoundedCornerShape(14.dp))
                        .background(if (on) T.goldf else Color.Transparent)
                        .clickable {
                            if (!on) nav.navigate(t.route) {
                                popUpTo("home") { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(t.icon, fontSize = 17.sp)
                    Text(t.label, color = if (on) T.gold else T.dim, fontSize = 10.sp,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}
