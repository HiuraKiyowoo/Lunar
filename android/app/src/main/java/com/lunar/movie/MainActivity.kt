package com.lunar.movie

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        ContinueWatching.init(this)
        // sentuh Api biar OkHttp siap
        setContent {
            Surface(color = T.ink, modifier = Modifier.fillMaxSize()) {
                LunarApp()
            }
        }
    }
}

@Composable
fun LunarApp() {
    val nav = rememberNavController()

    Box(Modifier.fillMaxSize().background(T.ink)) {
        NavHost(navController = nav, startDestination = "home") {
            composable("home") {
                HomeScreen(
                    onItem = { nav.navigate("detail/${it.slug}") },
                    onGenre = { nav.navigate("genre/${it.slug}") },
                    nav = nav,
                )
            }
            composable("search") { SearchScreen(onItem = { nav.navigate("detail/${it.slug}") }, nav = nav) }
            composable("genres") { GenreListScreen(onGenre = { nav.navigate("genre/${it.slug}") }, nav = nav) }
            composable("popular") { PopularScreen(onItem = { nav.navigate("detail/${it.slug}") }, nav = nav) }
            composable("info") { InfoScreen(nav = nav) }

            composable(
                "genre/{slug}",
                arguments = listOf(navArgument("slug") { type = NavType.StringType }),
            ) { e ->
                GenreScreen(
                    slug = e.arguments?.getString("slug") ?: "",
                    onItem = { nav.navigate("detail/${it.slug}") },
                    nav = nav,
                )
            }

            composable(
                "detail/{slug}",
                arguments = listOf(navArgument("slug") { type = NavType.StringType }),
            ) { e ->
                DetailScreen(
                    slug = e.arguments?.getString("slug") ?: "",
                    onBack = { nav.popBackStack() },
                    onPlay = { d, tmdbId, season, episode, title ->
                        nav.navigate(
                            "play/$tmdbId/${if (d.isSeries) "tv" else "movie"}/$season/$episode/${Uri2.encode(title)}"
                        )
                    },
                    onItem = { nav.navigate("detail/${it.slug}") },
                )
            }

            composable(
                "play/{tmdb}/{type}/{season}/{episode}/{title}",
                arguments = listOf(
                    navArgument("tmdb") { type = NavType.IntType },
                    navArgument("type") { type = NavType.StringType },
                    navArgument("season") { type = NavType.IntType },
                    navArgument("episode") { type = NavType.IntType },
                    navArgument("title") { type = NavType.StringType },
                ),
            ) { e ->
                PlayerScreen(
                    tmdbId = e.arguments?.getInt("tmdb") ?: 0,
                    type = e.arguments?.getString("type") ?: "movie",
                    season = e.arguments?.getInt("season") ?: 0,
                    episode = e.arguments?.getInt("episode") ?: 0,
                    title = Uri2.decode(e.arguments?.getString("title") ?: ""),
                    onBack = { nav.popBackStack() },
                )
            }
        }

        // nav bawah (otomatis hilang di detail/player)
        BottomNav(nav)
    }
}

/** Encode/decode judul untuk argumen navigasi. */
object Uri2 {
    fun encode(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
    fun decode(s: String): String = try { java.net.URLDecoder.decode(s, "UTF-8") } catch (e: Exception) { s }
}
