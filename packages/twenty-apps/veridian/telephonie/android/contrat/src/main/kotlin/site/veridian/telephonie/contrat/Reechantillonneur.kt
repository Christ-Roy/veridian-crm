package site.veridian.telephonie.contrat

/**
 * Rééchantillonnage par sinc fenêtré (Hann, 8 zéros de chaque côté, table de 256 phases), EN FLUX : seuls les
 * échantillons encore utiles au noyau sont gardés. Même sortie, échantillon pour échantillon, que l'ancien calcul
 * sur tout le fichier bordé de zéros (début et fin), et même nombre d'échantillons (n × cible / source, tronqué).
 */
class Reechantillonneur(val source: Int, val cible: Int) {
    private val identite = source == cible
    private val rapport = source.toDouble() / cible
    private val coupure = minOf(1.0, 1.0 / rapport) * 0.95
    private val demi = Math.ceil(8 / coupure).toInt()
    private val largeur = 2 * demi
    private val phases = 256
    private val noyau = FloatArray(phases * largeur).also { noyau ->
        for (p in 0 until phases) {
            val fraction = p.toDouble() / phases
            for (k in 0 until largeur) {
                val x = (k - demi + 1) - fraction
                val fenetre = if (Math.abs(x) >= demi) 0.0 else 0.5 * (1 + Math.cos(Math.PI * x / demi))
                val s = if (x == 0.0) 1.0 else Math.sin(Math.PI * x * coupure) / (Math.PI * x * coupure)
                noyau[p * largeur + k] = (coupure * s * fenetre).toFloat()
            }
        }
    }
    private var tampon = FloatArray(1 shl 16)
    private var base = -largeur.toLong()   // indice global (échantillon d'entrée) de tampon[0]
    private var longueur = largeur          // bordure de zéros avant le premier échantillon
    private var recus = 0L
    private var produits = 0L
    private val sortie = ShortArray(1 shl 14)

    fun pousser(x: ShortArray, n: Int, emettre: (ShortArray, Int) -> Unit) {
        recus += n
        if (identite) { emettre(x, n); return }
        assurer(n)
        for (i in 0 until n) tampon[longueur + i] = x[i].toFloat()
        longueur += n
        produire(Long.MAX_VALUE, emettre)
    }

    fun finir(emettre: (ShortArray, Int) -> Unit) {
        if (identite) return
        assurer(largeur)
        java.util.Arrays.fill(tampon, longueur, longueur + largeur, 0f)
        longueur += largeur
        produire((recus * cible) / source, emettre)
    }

    private fun assurer(n: Int) {
        if (longueur + n > tampon.size) tampon = tampon.copyOf(maxOf(tampon.size * 2, longueur + n))
    }

    private fun produire(limite: Long, emettre: (ShortArray, Int) -> Unit) {
        var k = 0
        while (produits < limite) {
            val t = produits * rapport
            val b = t.toLong()
            val j0 = b - demi + 1
            if (j0 + largeur > base + longueur) break
            val h = ((t - b) * phases).toInt().coerceIn(0, phases - 1) * largeur
            val off = (j0 - base).toInt()
            var somme = 0f
            for (q in 0 until largeur) somme += tampon[off + q] * noyau[h + q]
            if (k == sortie.size) { emettre(sortie, k); k = 0 }
            sortie[k++] = somme.coerceIn(-32768f, 32767f).toInt().toShort()
            produits++
        }
        if (k > 0) emettre(sortie, k)
        val jeter = ((produits * rapport).toLong() - demi + 1 - base).toInt().coerceIn(0, longueur)
        if (jeter > 0) { System.arraycopy(tampon, jeter, tampon, 0, longueur - jeter); longueur -= jeter; base += jeter }
    }
}
