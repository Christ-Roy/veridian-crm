package site.veridian.telephonie

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteOrder

/**
 * Audio sans ffmpeg, par les codecs d'Android : décodage (Opus de JemRec, AMR de la messagerie) en PCM mono,
 * rééchantillonnage, et Opus mono 32 kbit/s en Ogg pour le CRM (comme `compresser_audio` : un navigateur ne lit pas
 * l'AMR, et JemRec écrit en stéréo vers 140 kbit/s deux voies identiques).
 */
object Audio {
    class Pcm(val echantillons: ShortArray, val taux: Int)

    /** Tout le fichier en PCM 16 bits mono (moyenne des voies), au taux d'origine. */
    fun decoder(fichier: File): Pcm {
        val extracteur = MediaExtractor()
        extracteur.setDataSource(fichier.path)
        val piste = (0 until extracteur.trackCount).first { extracteur.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("audio/") }
        extracteur.selectTrack(piste)
        val format = extracteur.getTrackFormat(piste)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        var taux = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var voies = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var flottant = false
        val sortie = ShortTampon(maxOf(1024, (format.getLongOrZero(MediaFormat.KEY_DURATION) / 1_000_000 * taux).toInt()))
        val info = MediaCodec.BufferInfo()
        var finEntree = false
        try {
            while (true) {
                if (!finEntree) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val n = extracteur.readSampleData(codec.getInputBuffer(i)!!, 0)
                        if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); finEntree = true }
                        else { codec.queueInputBuffer(i, 0, n, extracteur.sampleTime, 0); extracteur.advance() }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    taux = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    voies = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    flottant = codec.outputFormat.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                        codec.outputFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
                } else if (o >= 0) {
                    val tampon = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN)
                    tampon.position(info.offset); tampon.limit(info.offset + info.size)
                    if (flottant) {
                        val f = tampon.asFloatBuffer()
                        for (t in 0 until f.remaining() / voies) {
                            var somme = 0f
                            for (v in 0 until voies) somme += f.get(t * voies + v)
                            sortie.ajouter((somme / voies * 32767f).coerceIn(-32768f, 32767f).toInt().toShort())
                        }
                    } else {
                        val s = tampon.asShortBuffer()
                        for (t in 0 until s.remaining() / voies) {
                            var somme = 0
                            for (v in 0 until voies) somme += s.get(t * voies + v)
                            sortie.ajouter((somme / voies).toShort())
                        }
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        } finally {
            codec.stop(); codec.release(); extracteur.release()
        }
        return Pcm(sortie.tableau(), taux)
    }

    private fun MediaFormat.getLongOrZero(cle: String) = if (containsKey(cle)) getLong(cle) else 0L

    /** Rééchantillonnage par sinc fenêtré (Hann, 16 zéros de chaque côté, table de 512 phases). */
    fun reechantillonner(pcm: Pcm, taux: Int): ShortArray {
        if (pcm.taux == taux) return pcm.echantillons
        val entree = pcm.echantillons
        val rapport = pcm.taux.toDouble() / taux
        val coupure = minOf(1.0, 1.0 / rapport) * 0.97
        val zeros = 16
        val demi = Math.ceil(zeros / coupure).toInt()
        val phases = 512
        val noyau = Array(phases) { p ->
            val fraction = p.toDouble() / phases
            DoubleArray(2 * demi) { k ->
                val x = (k - demi + 1) - fraction
                val fenetre = if (Math.abs(x) >= demi) 0.0 else 0.5 * (1 + Math.cos(Math.PI * x / demi))
                val s = if (x == 0.0) 1.0 else Math.sin(Math.PI * x * coupure) / (Math.PI * x * coupure)
                coupure * s * fenetre
            }
        }
        val n = ((entree.size.toLong() * taux) / pcm.taux).toInt()
        val sortie = ShortArray(n)
        for (i in 0 until n) {
            val t = i * rapport
            val base = Math.floor(t).toInt()
            val phase = ((t - base) * phases).toInt().coerceIn(0, phases - 1)
            val h = noyau[phase]
            var somme = 0.0
            var k = 0
            var j = base - demi + 1
            while (k < h.size) {
                if (j in entree.indices) somme += entree[j] * h[k]
                k++; j++
            }
            sortie[i] = somme.coerceIn(-32768.0, 32767.0).toInt().toShort()
        }
        return sortie
    }

    private val TAUX_OPUS = intArrayOf(8000, 12000, 16000, 24000, 48000)

    /** Opus mono 32 kbit/s en Ogg ; null si l'encodeur échoue (l'original part alors tel quel). */
    fun versOpus(source: File, sortie: File): File? = try {
        val pcm = decoder(source)
        val taux = if (pcm.taux in TAUX_OPUS) pcm.taux else 48000
        val echantillons = reechantillonner(pcm, taux)
        encoderOpus(echantillons, taux, sortie)
        sortie.takeIf { it.length() > 0 }
    } catch (e: Exception) {
        Journal.erreur("Opus de ${source.name}", e)
        sortie.delete(); null
    }

    private fun encoderOpus(pcm: ShortArray, taux: Int, fichier: File) {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, taux, 1).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, 32_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        val muxer = MediaMuxer(fichier.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG)
        var piste = -1
        val info = MediaCodec.BufferInfo()
        var position = 0
        var finEntree = false
        try {
            while (true) {
                if (!finEntree) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val tampon = codec.getInputBuffer(i)!!.order(ByteOrder.LITTLE_ENDIAN)
                        val n = minOf(tampon.capacity() / 2, pcm.size - position, taux / 50 * 10)
                        val temps = position * 1_000_000L / taux
                        if (n <= 0) {
                            codec.queueInputBuffer(i, 0, 0, temps, MediaCodec.BUFFER_FLAG_END_OF_STREAM); finEntree = true
                        } else {
                            tampon.asShortBuffer().put(pcm, position, n)
                            codec.queueInputBuffer(i, 0, n * 2, temps, 0)
                            position += n
                        }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    piste = muxer.addTrack(codec.outputFormat); muxer.start()
                } else if (o >= 0) {
                    val estConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    if (!estConfig && info.size > 0 && piste >= 0) muxer.writeSampleData(piste, codec.getOutputBuffer(o)!!, info)
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        } finally {
            codec.stop(); codec.release()
            try { if (piste >= 0) muxer.stop() } finally { muxer.release() }
        }
    }

    /** Tableau extensible de Short, sans boîtes. */
    class ShortTampon(initial: Int) {
        private var t = ShortArray(initial)
        private var n = 0
        fun ajouter(x: Short) { if (n == t.size) t = t.copyOf(t.size * 2); t[n++] = x }
        fun tableau(): ShortArray = t.copyOf(n)
    }
}
