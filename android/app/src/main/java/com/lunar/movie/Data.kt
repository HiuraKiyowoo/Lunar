package com.lunar.movie

import androidx.compose.ui.graphics.Color

/** Palet warna MovieZone (dari CSS asli). */
object T {
    val ink = Color(0xFF080A0C)
    val inkl = Color(0xFF0F1215)
    val inke = Color(0xFF161B20)
    val gold = Color(0xFFF5A623)
    val goldf = Color(0x1FF5A623)   // 12% emas
    val silver = Color(0xFFA0AAB4)
    val dim = Color(0xFF505A65)
    val text = Color(0xFFE8EDF2)
    val textmain = Color(0xFFE8EDF2)
    val line = Color(0x12FFFFFF)    // putih 7%
    val ghost = Color(0x0DFFFFFF)   // putih 5%
    val blue = Color(0xFF3B82F6)    // badge SERIES
}

/** Bikin warna dari hex string "#RRGGBB". */
fun hexColor(hex: String, fallback: Color = T.dim): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (e: Exception) {
    fallback
}
