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
    /**
     * Décodage en flux : chaque bloc PCM 16 bits mono (moyenne des voies) est rendu à `bloc(échantillons, n, taux)`
     * dès sa sortie du codec. Rien n'est gardé : la mémoire ne dépend pas de la durée (le 12/11, un appel de 1 h 42
     * chargé d'un seul tenant faisait OutOfMemoryError et la transcription bouclait).
     */
    fun decoderEnFlux(fichier: File, bloc: (ShortArray, Int, Int) -> Unit) {
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
        val info = MediaCodec.BufferInfo()
        var finEntree = false
        // Toutes les entrées libres d'abord, puis toutes les sorties prêtes : un aller-retour par trame de 20 ms (attente
        // de 10 ms à chaque tour) prenait 95 s pour 10 min d'appel, mesuré le 12/11.
        var brut = ShortArray(0)
        var flotBloc = FloatArray(0)
        var mono = ShortArray(0)
        try {
            var fini = false
            while (!fini) {
                while (!finEntree) {
                    val i = codec.dequeueInputBuffer(0)
                    if (i < 0) break
                    val n = extracteur.readSampleData(codec.getInputBuffer(i)!!, 0)
                    if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); finEntree = true }
                    else { codec.queueInputBuffer(i, 0, n, extracteur.sampleTime, 0); extracteur.advance() }
                }
                var o = codec.dequeueOutputBuffer(info, 5_000)
                while (o != MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        taux = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        voies = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        flottant = codec.outputFormat.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            codec.outputFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
                    } else if (o >= 0) {
                        val tampon = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN)
                        tampon.position(info.offset); tampon.limit(info.offset + info.size)
                        var m = 0
                        if (flottant) {
                            val f = tampon.asFloatBuffer()
                            val n = f.remaining()
                            if (flotBloc.size < n) flotBloc = FloatArray(n)
                            if (mono.size < n) mono = ShortArray(n)
                            f.get(flotBloc, 0, n)
                            var t = 0
                            while (t + voies <= n) {
                                var somme = 0f
                                for (v in 0 until voies) somme += flotBloc[t + v]
                                mono[m++] = (somme / voies * 32767f).coerceIn(-32768f, 32767f).toInt().toShort(); t += voies
                            }
                        } else {
                            val sb = tampon.asShortBuffer()
                            val n = sb.remaining()
                            if (brut.size < n) brut = ShortArray(n)
                            if (mono.size < n) mono = ShortArray(n)
                            sb.get(brut, 0, n)
                            var t = 0
                            while (t + voies <= n) {
                                var somme = 0
                                for (v in 0 until voies) somme += brut[t + v]
                                mono[m++] = (somme / voies).toShort(); t += voies
                            }
                        }
                        codec.releaseOutputBuffer(o, false)
                        if (m > 0) bloc(mono, m, taux)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) { fini = true; break }
                    }
                    o = codec.dequeueOutputBuffer(info, 0)
                }
            }
        } finally {
            codec.stop(); codec.release(); extracteur.release()
        }
    }

    /**
     * Décode `fichier` vers `sortie` en PCM 16 bits mono petit-boutiste, au taux `cible(taux d'origine)`, en flux
     * (mémoire bornée). Rend (nombre d'échantillons, taux). Fichier écrit en `.part` puis renommé.
     */
    fun versPcm(fichier: File, sortie: File, cible: (Int) -> Int): Pair<Long, Int> {
        val partiel = File(sortie.path + ".part")
        var r: site.veridian.telephonie.contrat.Reechantillonneur? = null
        var ecrits = 0L
        val octets = java.nio.ByteBuffer.allocate(1 shl 16).order(ByteOrder.LITTLE_ENDIAN)
        java.io.BufferedOutputStream(java.io.FileOutputStream(partiel), 1 shl 16).use { flux ->
            val ecrire: (ShortArray, Int) -> Unit = { x, n ->
                var i = 0
                while (i < n) {
                    octets.clear()
                    val k = minOf(n - i, octets.capacity() / 2)
                    octets.asShortBuffer().put(x, i, k)
                    flux.write(octets.array(), 0, k * 2)
                    i += k; ecrits += k
                }
            }
            decoderEnFlux(fichier) { x, n, taux ->
                val re = r ?: site.veridian.telephonie.contrat.Reechantillonneur(taux, cible(taux)).also { r = it }
                re.pousser(x, n, ecrire)
            }
            r?.finir(ecrire)
        }
        if (!partiel.renameTo(sortie)) throw java.io.IOException("renommage de ${partiel.name}")
        return ecrits to (r?.cible ?: 16_000)
    }

    /** Lit `n` échantillons à partir de l'échantillon `de` d'un fichier PCM 16 bits (tronçon de transcription). */
    fun lirePcm(fichier: File, de: Long, n: Int): ShortArray {
        val octets = ByteArray(n * 2)
        java.io.RandomAccessFile(fichier, "r").use { f -> f.seek(de * 2); f.readFully(octets) }
        return ShortArray(n).also { java.nio.ByteBuffer.wrap(octets).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(it) }
    }

    /** Parcourt un fichier PCM 16 bits par blocs de 64 Ki échantillons. */
    fun parcourirPcm(fichier: File, bloc: (ShortArray, Int) -> Unit) {
        val octets = ByteArray(1 shl 17)
        val x = ShortArray(1 shl 16)
        java.io.BufferedInputStream(java.io.FileInputStream(fichier), 1 shl 17).use { e ->
            while (true) {
                var lus = 0
                while (lus < octets.size) { val r = e.read(octets, lus, octets.size - lus); if (r < 0) break; lus += r }
                val n = lus / 2
                if (n == 0) break
                java.nio.ByteBuffer.wrap(octets, 0, n * 2).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(x, 0, n)
                bloc(x, n)
                if (lus < octets.size) break
            }
        }
    }

    private fun MediaFormat.getLongOrZero(cle: String) = if (containsKey(cle)) getLong(cle) else 0L

    private val TAUX_OPUS = intArrayOf(8000, 12000, 16000, 24000, 48000)

    /** Opus mono 32 kbit/s en Ogg ; null si l'encodeur échoue (l'original part alors tel quel). */
    fun versOpus(source: File, sortie: File): File? {
        val pcm = File(sortie.path + ".pcm")
        return try {
            val (_, taux) = versPcm(source, pcm) { t -> if (t in TAUX_OPUS) t else 48000 }
            encoderOpus(pcm, taux, sortie)
            sortie.takeIf { it.length() > 0 }
        } catch (e: Throwable) {
            // OutOfMemoryError compris : l'original part tel quel, le fil des fichiers ne meurt pas.
            Journal.log("Opus de ${source.name} impossible (${e.javaClass.simpleName} ${e.message}) : original envoyé")
            sortie.delete(); null
        } finally { pcm.delete(); File(pcm.path + ".part").delete() }
    }

    private fun encoderOpus(pcmFichier: File, taux: Int, fichier: File) {
        val total = pcmFichier.length() / 2
        val lecture = java.io.BufferedInputStream(java.io.FileInputStream(pcmFichier), 1 shl 16)
        val octets = ByteArray(64 * 1024)
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
        var position = 0L
        var finEntree = false
        try {
            while (true) {
                if (!finEntree) {
                    val i = codec.dequeueInputBuffer(0)
                    if (i >= 0) {
                        val tampon = codec.getInputBuffer(i)!!.order(ByteOrder.LITTLE_ENDIAN)
                        val n = minOf((tampon.capacity() / 2).toLong(), total - position, (taux / 50 * 10).toLong(), (octets.size / 2).toLong()).toInt()
                        val temps = position * 1_000_000L / taux
                        if (n <= 0) {
                            codec.queueInputBuffer(i, 0, 0, temps, MediaCodec.BUFFER_FLAG_END_OF_STREAM); finEntree = true
                        } else {
                            var lus = 0
                            while (lus < n * 2) { val r = lecture.read(octets, lus, n * 2 - lus); if (r < 0) break; lus += r }
                            tampon.clear(); tampon.put(octets, 0, lus)
                            codec.queueInputBuffer(i, 0, lus, temps, 0)
                            position += lus / 2
                        }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 1_000)
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
            lecture.close()
            codec.stop(); codec.release()
            try { if (piste >= 0) muxer.stop() } finally { muxer.release() }
        }
    }
}
