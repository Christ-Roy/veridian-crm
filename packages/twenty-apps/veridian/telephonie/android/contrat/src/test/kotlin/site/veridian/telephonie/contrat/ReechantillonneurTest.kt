package site.veridian.telephonie.contrat

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Random

/**
 * Le rééchantillonneur en flux rend exactement ce que rendait l'ancien calcul sur tout le fichier (copié ci-dessous
 * tel qu'il était dans Audio.kt jusqu'au 12/11/2026), quelle que soit la taille des blocs reçus du décodeur.
 */
class ReechantillonneurTest {

    /** Référence : l'algorithme d'origine, tout en mémoire (OutOfMemoryError sur un appel de 1 h 42). */
    private fun reference(pcm: ShortArray, source: Int, taux: Int): ShortArray {
        if (source == taux) return pcm
        val rapport = source.toDouble() / taux
        val coupure = minOf(1.0, 1.0 / rapport) * 0.95
        val demi = Math.ceil(8 / coupure).toInt()
        val largeur = 2 * demi
        val phases = 256
        val noyau = FloatArray(phases * largeur)
        for (p in 0 until phases) {
            val fraction = p.toDouble() / phases
            for (k in 0 until largeur) {
                val x = (k - demi + 1) - fraction
                val fenetre = if (Math.abs(x) >= demi) 0.0 else 0.5 * (1 + Math.cos(Math.PI * x / demi))
                val s = if (x == 0.0) 1.0 else Math.sin(Math.PI * x * coupure) / (Math.PI * x * coupure)
                noyau[p * largeur + k] = (coupure * s * fenetre).toFloat()
            }
        }
        val entree = FloatArray(pcm.size + 2 * largeur)
        for (i in pcm.indices) entree[i + largeur] = pcm[i].toFloat()
        val n = ((pcm.size.toLong() * taux) / source).toInt()
        val sortie = ShortArray(n)
        for (i in 0 until n) {
            val t = i * rapport
            val base = t.toInt()
            val h = ((t - base) * phases).toInt().coerceIn(0, phases - 1) * largeur
            val j0 = base - demi + 1 + largeur
            var somme = 0f
            for (k in 0 until largeur) somme += entree[j0 + k] * noyau[h + k]
            sortie[i] = somme.coerceIn(-32768f, 32767f).toInt().toShort()
        }
        return sortie
    }

    private fun enFlux(pcm: ShortArray, source: Int, taux: Int, blocs: (Int) -> Int): ShortArray {
        val r = Reechantillonneur(source, taux)
        val sortie = ArrayList<Short>()
        val emettre: (ShortArray, Int) -> Unit = { x, n -> for (i in 0 until n) sortie += x[i] }
        var i = 0
        var k = 0
        while (i < pcm.size) { val n = minOf(blocs(k++), pcm.size - i); r.pousser(pcm.copyOfRange(i, i + n), n, emettre); i += n }
        r.finir(emettre)
        return sortie.toShortArray()
    }

    private fun signal(n: Int, graine: Long): ShortArray {
        val a = Random(graine)
        return ShortArray(n) { i -> (8000 * Math.sin(i * 0.013) + 3000 * Math.sin(i * 0.31) + a.nextGaussian() * 900).toInt().toShort() }
    }

    @Test fun identiqueALaReference() {
        val a = Random(7)
        for ((source, taux) in listOf(48_000 to 16_000, 44_100 to 16_000, 8_000 to 16_000, 16_000 to 16_000, 44_100 to 48_000)) {
            val pcm = signal(source * 3 + 17, source.toLong())
            val attendu = reference(pcm, source, taux)
            for (taille in listOf(1, 960, 1024, 4801, 1 shl 16)) {
                assertArrayEquals("$source → $taux, blocs de $taille", attendu, enFlux(pcm, source, taux) { taille })
            }
            assertArrayEquals("$source → $taux, blocs aléatoires", attendu, enFlux(pcm, source, taux) { 1 + a.nextInt(5000) })
        }
    }

    /** La mémoire ne grandit pas avec la durée : 10 min à 48 kHz passent par un tampon de quelques Ko. */
    @Test fun memoireBornee() {
        val r = Reechantillonneur(48_000, 16_000)
        var total = 0L
        val bloc = signal(960, 1)
        repeat(30_000) { r.pousser(bloc, bloc.size) { _, n -> total += n } }
        r.finir { _, n -> total += n }
        assertEquals(30_000L * 960 / 3, total)
        val champ = Reechantillonneur::class.java.getDeclaredField("tampon").apply { isAccessible = true }
        assert((champ.get(r) as FloatArray).size <= 1 shl 16)
    }
}
