package site.veridian.telephonie

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.provider.Settings
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.math.BigInteger
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Le shell du téléphone (uid 2000) pour l'app elle-même : la messagerie vocale n'est lisible qu'avec
 * READ_VOICEMAIL, réservée au système (protection `signature|privileged|role`, mesurée sur ce Pixel le 12/11/2026),
 * et le shell la lit. Même voie que JemRec : le protocole adb, vers adbd du téléphone.
 *
 *  - adb en TCP sur 127.0.0.1:5555 (ouvert par `adb tcpip`) : clé RSA propre à l'app (aucune clé ni service de
 *    Termux), acceptée une fois à l'écran (« toujours autoriser »), puis dans /data/misc/adb/adb_keys ;
 *  - après un redémarrage, 5555 est fermé : l'app rallume le débogage sans fil (WRITE_SECURE_SETTINGS), trouve son
 *    port (mDNS `_adb-tls-connect._tcp`, sinon balayage local), s'y connecte en TLS avec la même clé, et rouvre
 *    5555 (`tcpip:5555`), ce que faisait le câble USB sur rbt.
 *
 * Une commande à la fois (verrou). Le protocole : https://android.googlesource.com/platform/packages/modules/adb/+/main/protocol.txt
 */
class Adb(private val ctx: Context) {
    private var cles = Cles(ctx)
    private var connexion: Connexion? = null
    @Volatile var etat: String = "non connecté"; private set

    /** Sortie d'une commande (exec:, binaire sûr). Lève NonAbouti si adbd est injoignable ou refuse. */
    @Synchronized
    fun executer(commande: String, delaiMs: Long = 60_000): ByteArray {
        for (essai in 0..1) {
            // Toute erreur de connexion (TLS refusé, port fermé) est un « non abouti », jamais une exception qui
            // remonte : le 12/11 après un redémarrage, un SSLProtocolException non attrapé faisait planter l'app en
            // boucle, et Android repoussait sa relance de 3 heures.
            val c = try { connexion ?: connecter() } catch (e: NonAbouti) { throw e } catch (e: Exception) {
                fermer(); etat = "échec de connexion (${e.javaClass.simpleName})"; throw NonAbouti("adb : ${e.message}", e)
            }
            autoriserReouverture(c)
            try {
                return c.exec(commande, delaiMs)
            } catch (e: Exception) {
                fermer()
                if (essai == 1) throw NonAbouti("adb : ${e.message}", e)
            }
        }
        throw NonAbouti("adb")
    }

    private var reouvertureDemandee = false

    /** Une fois connecté, le shell s'accorde à l'app WRITE_SECURE_SETTINGS (protection « development ») : elle rallume
     *  seule le débogage sans fil après un redémarrage. Un tiers n'a ainsi aucune commande pm grant à taper. */
    private fun autoriserReouverture(c: Connexion) {
        if (reouvertureDemandee) return
        reouvertureDemandee = true
        if (ctx.checkSelfPermission(android.Manifest.permission.WRITE_SECURE_SETTINGS) == android.content.pm.PackageManager.PERMISSION_GRANTED) return
        try {
            c.exec("pm grant ${ctx.packageName} android.permission.WRITE_SECURE_SETTINGS", 15_000)
            Journal.log("adb : WRITE_SECURE_SETTINGS accordée par le shell")
        } catch (e: Exception) { Journal.erreur("adb : pm grant", e) }
    }

    fun texte(commande: String, delaiMs: Long = 60_000) = executer(commande, delaiMs).toString(Charsets.UTF_8)

    @Synchronized
    fun fermer() {
        try { connexion?.socket?.close() } catch (_: Exception) {}
        connexion = null
        cles = Cles(ctx)
    }

    private fun connecter(): Connexion {
        try {
            return Connexion.ouvrir(InetSocketAddress("127.0.0.1", 5555), cles, tls = false).also {
                connexion = it; etat = "connecté (tcp 5555)" }
        } catch (e: ClefRefusee) {
            etat = "clé de l'app en attente d'acceptation à l'écran"; throw NonAbouti(etat)
        } catch (e: Exception) {
            etat = "5555 fermé (${e.message})"
        }
        // 5555 fermé (redémarrage) : débogage sans fil, TLS, puis réouverture de 5555. Il exige le Wi-Fi : sans lui,
        // ni balayage ni mDNS (batterie), on attend son retour.
        if (!wifi()) { etat = "5555 fermé, pas de Wi-Fi"; throw NonAbouti("adb : 5555 fermé et pas de Wi-Fi") }
        val port = portSansFil() ?: throw NonAbouti("adb : 5555 fermé et débogage sans fil introuvable")
        val tls = Connexion.ouvrir(InetSocketAddress("127.0.0.1", port), cles, tls = true)
        etat = "connecté (sans fil $port)"
        // `tcpip:5555` redémarre adbd, et init tue avec lui tout ce qu'il a lancé : l'enregistreur de JemRec
        // (documenté par JemRec, « Staying alive without Wi-Fi »). Jamais pendant un appel : on garde alors la
        // connexion sans fil. Hors appel, on rouvre (5555 sert au shell hors Wi-Fi jusqu'au prochain redémarrage) et
        // JemRec, en Wi-Fi, relance son enregistreur en quelques secondes ; l'app le vérifie (Enregistreur).
        val jemrec = try { String(tls.exec("ps -A -o ARGS | grep -c '[c]om.jemcik.jemrec.shell.Main' || true", 10_000)).trim().toIntOrNull() ?: 0 } catch (_: Exception) { 0 }
        val enAppel = try { ctx.getSystemService(android.telephony.TelephonyManager::class.java).callStateForSubscription != android.telephony.TelephonyManager.CALL_STATE_IDLE } catch (_: Exception) { true }
        if (jemrec > 0 && enAppel) {
            Journal.log("adb : appel en cours, 5555 laissé fermé (rouvrir tuerait l'enregistreur de JemRec), connexion sans fil ($port)")
            connexion = tls; etat = "connecté (sans fil $port, 5555 fermé pendant l'appel)"
            return tls
        }
        if (jemrec > 0) Journal.log("adb : réouverture de 5555 hors appel, l'enregistreur de JemRec redémarre avec adbd (JemRec le relance)")
        try {
            tls.service("tcpip:5555", 10_000)
        } catch (e: java.io.EOFException) {
            // adbd redémarre en mode TCP et coupe la connexion : c'est la réussite attendue
        } catch (e: Exception) {
            Journal.erreur("adb : tcpip:5555", e)
        }
        Journal.log("adb : port 5555 rouvert par le débogage sans fil ($port)")
        if (jemrec > 0) Enregistreur.instance?.verifier("5555 rouvert", 20_000, 60_000)
        try { tls.socket.close() } catch (_: Exception) {}
        Thread.sleep(2500)
        return Connexion.ouvrir(InetSocketAddress("127.0.0.1", 5555), cles, tls = false).also {
            connexion = it; etat = "connecté (tcp 5555, rouvert)" }
    }

    private fun wifi(): Boolean {
        val cm = ctx.getSystemService(android.net.ConnectivityManager::class.java)
        return cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) == true }
    }

    /** Port TLS du débogage sans fil, rallumé au besoin (il faut le Wi-Fi). */
    private fun portSansFil(): Int? {
        try {
            if (Settings.Global.getInt(ctx.contentResolver, "adb_wifi_enabled", 0) != 1) {
                Settings.Global.putInt(ctx.contentResolver, "adb_wifi_enabled", 1)
                Journal.log("adb : débogage sans fil rallumé")
                Thread.sleep(3000)
            }
        } catch (e: SecurityException) {
            Journal.erreur("adb : WRITE_SECURE_SETTINGS manquant", e)
        }
        return portMdns() ?: balayer()
    }

    private fun portMdns(): Int? {
        val nsd = ctx.getSystemService(NsdManager::class.java) ?: return null
        val trouve = CountDownLatch(1)
        var port: Int? = null
        val ecoute = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(t: String?, e: Int) { trouve.countDown() }
            override fun onStopDiscoveryFailed(t: String?, e: Int) {}
            override fun onDiscoveryStarted(t: String?) {}
            override fun onDiscoveryStopped(t: String?) {}
            override fun onServiceLost(s: NsdServiceInfo?) {}
            @Suppress("DEPRECATION")
            override fun onServiceFound(s: NsdServiceInfo) {
                nsd.resolveService(s, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(s: NsdServiceInfo?, e: Int) {}
                    override fun onServiceResolved(s: NsdServiceInfo) {
                        val adresses = s.hostAddresses.map { it.hostAddress }
                        if (adresses.any { estLocale(it) }) { port = s.port; trouve.countDown() }
                    }
                })
            }
        }
        return try {
            nsd.discoverServices("_adb-tls-connect._tcp", NsdManager.PROTOCOL_DNS_SD, ecoute)
            trouve.await(8, TimeUnit.SECONDS)
            port
        } catch (e: Exception) {
            null
        } finally {
            try { nsd.stopServiceDiscovery(ecoute) } catch (_: Exception) {}
        }
    }

    private fun estLocale(adresse: String?): Boolean = try {
        java.net.NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
            .any { it.hostAddress == adresse }
    } catch (_: Exception) { false }

    /** Repli : les ports TCP ouverts en local, puis le premier qui répond STLS à un CNXN. */
    private fun balayer(): Int? {
        val ouverts = (1024..65535).toList().parallelStream().filter { p ->
            p != 5555 && p != 5037 && p != 8022 && try {
                Socket().use { it.connect(InetSocketAddress("127.0.0.1", p), 150) }; true
            } catch (_: Exception) { false }
        }.toArray().map { it as Int }
        return ouverts.firstOrNull { Connexion.repondSTLS(it) }
    }

    // ------------------------------------------------------------ protocole

    class ClefRefusee : Exception("clé refusée")

    class Connexion private constructor(val socket: Socket, private var entree: DataInputStream, private var sortie: OutputStream) {
        private var prochainId = 1

        fun exec(commande: String, delaiMs: Long): ByteArray = service("exec:$commande", delaiMs)

        fun service(destination: String, delaiMs: Long): ByteArray {
            val local = prochainId++
            socket.soTimeout = delaiMs.toInt().coerceAtLeast(1000)
            envoyer(OPEN, local, 0, (destination + "\u0000").toByteArray())
            val tampon = ByteArrayOutputStream()
            var distant = 0
            while (true) {
                val m = lire()
                when (m.commande) {
                    OKAY -> distant = m.arg0
                    WRTE -> { tampon.write(m.donnees); envoyer(OKAY, local, m.arg0, ByteArray(0)) }
                    CLSE -> { if (distant != 0 || m.arg0 != 0) envoyer(CLSE, local, m.arg0, ByteArray(0)); return tampon.toByteArray() }
                    else -> {}
                }
            }
        }

        private fun envoyer(commande: Int, a0: Int, a1: Int, donnees: ByteArray) = Companion.envoyer(sortie, commande, a0, a1, donnees)
        private fun lire(): Message = Companion.lire(entree)

        companion object {
            const val SYNC = 0x434e5953; const val CNXN = 0x4e584e43; const val OPEN = 0x4e45504f; const val OKAY = 0x59414b4f
            const val CLSE = 0x45534c43; const val WRTE = 0x45545257; const val AUTH = 0x48545541; const val STLS = 0x534c5453
            const val VERSION = 0x01000001; const val VERSION_STLS = 0x01000000; const val MAX = 256 * 1024

            class Message(val commande: Int, val arg0: Int, val arg1: Int, val donnees: ByteArray)

            fun envoyer(sortie: OutputStream, commande: Int, a0: Int, a1: Int, donnees: ByteArray) {
                val tete = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
                tete.putInt(commande).putInt(a0).putInt(a1).putInt(donnees.size)
                    .putInt(donnees.sumOf { it.toInt() and 0xff }).putInt(commande.inv())
                synchronized(sortie) { sortie.write(tete.array()); sortie.write(donnees); sortie.flush() }
            }

            fun lire(entree: DataInputStream): Message {
                val tete = ByteArray(24)
                entree.readFully(tete)
                val b = ByteBuffer.wrap(tete).order(ByteOrder.LITTLE_ENDIAN)
                val commande = b.int; val a0 = b.int; val a1 = b.int; val taille = b.int
                if (taille < 0 || taille > 16 * 1024 * 1024) throw java.io.IOException("trame adb invalide")
                val donnees = ByteArray(taille)
                entree.readFully(donnees)
                return Message(commande, a0, a1, donnees)
            }

            private fun cnxn(sortie: OutputStream) = envoyer(sortie, CNXN, VERSION, MAX,
                "host::features=shell_v2,cmd,stat_v2,ls_v2,fixed_push_mkdir,apex,abb,abb_exec\u0000".toByteArray())

            fun repondSTLS(port: Int): Boolean = try {
                Socket().use { s ->
                    s.connect(InetSocketAddress("127.0.0.1", port), 500); s.soTimeout = 1500
                    cnxn(s.getOutputStream()); lire(DataInputStream(s.getInputStream())).commande == STLS
                }
            } catch (_: Exception) { false }

            fun ouvrir(adresse: InetSocketAddress, cles: Cles, tls: Boolean): Connexion {
                val socket = Socket()
                socket.connect(adresse, 3000)
                socket.soTimeout = 10_000
                var entree = DataInputStream(socket.getInputStream())
                var sortie: OutputStream = socket.getOutputStream()
                cnxn(sortie)
                var cleEnvoyee = false
                var jetonSigne = false
                var tlsSocket: SSLSocket? = null
                while (true) {
                    val m = try { lire(entree) } catch (e: java.net.SocketTimeoutException) {
                        socket.close(); if (cleEnvoyee) throw ClefRefusee() else throw e
                    }
                    when (m.commande) {
                        CNXN -> return Connexion(tlsSocket ?: socket, entree, sortie)
                        STLS -> {
                            envoyer(sortie, STLS, VERSION_STLS, 0, ByteArray(0))
                            tlsSocket = cles.tls().socketFactory.createSocket(socket, adresse.hostString, adresse.port, true) as SSLSocket
                            tlsSocket.useClientMode = true
                            tlsSocket.startHandshake()
                            entree = DataInputStream(tlsSocket.inputStream); sortie = tlsSocket.outputStream
                        }
                        AUTH -> {
                            if (m.arg0 != 1) continue
                            if (!cleEnvoyee) {
                                // un jeton signé refusé renvoie un nouveau jeton : alors la clé publique (dialogue à l'écran)
                                if (m.donnees.isNotEmpty() && !jetonSigne) {
                                    jetonSigne = true
                                    envoyer(sortie, AUTH, 2, 0, cles.signer(m.donnees)); continue
                                }
                                cleEnvoyee = true
                                envoyer(sortie, AUTH, 3, 0, cles.publiqueAdb())
                                socket.soTimeout = 60_000
                                Journal.log("adb : clé de l'app présentée (empreinte ${cles.empreinte()}), en attente d'acceptation à l'écran")
                            }
                        }
                        else -> {}
                    }
                }
            }
        }
    }

    /** Clé RSA 2048 de l'app (fichiers privés), au format adb, et certificat auto-signé pour le TLS. */
    class Cles(ctx: Context) {
        private val dossier = File(ctx.filesDir, "adb").apply { mkdirs() }
        private val paire: KeyPair by lazy { charger() }

        private fun charger(): KeyPair {
            val prive = File(dossier, "adbkey"); val publique = File(dossier, "adbkey.pub.der")
            if (prive.exists() && publique.exists()) {
                val kf = KeyFactory.getInstance("RSA")
                return KeyPair(kf.generatePublic(X509EncodedKeySpec(publique.readBytes())),
                    kf.generatePrivate(PKCS8EncodedKeySpec(prive.readBytes())))
            }
            val p = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
            prive.writeBytes(p.private.encoded); publique.writeBytes(p.public.encoded)
            return p
        }

        /** Signature PKCS#1 v1.5 du jeton, traité comme une empreinte SHA-1 déjà calculée (comme adb). */
        fun signer(jeton: ByteArray): ByteArray {
            val s = Signature.getInstance("NONEwithRSA")
            s.initSign(paire.private)
            s.update(SHA1_DIGESTINFO + jeton)
            return s.sign()
        }

        /** struct RSAPublicKey d'adb (mots de 32 bits petit-boutistes) en base64, puis « nom\0 ». */
        fun publiqueAdb(): ByteArray {
            val pub = paire.public as RSAPublicKey
            val n = pub.modulus
            val mots = 64
            val r32 = BigInteger.ONE.shiftLeft(32)
            val n0inv = n.mod(r32).modInverse(r32).negate().mod(r32)
            val rr = BigInteger.ONE.shiftLeft(4096).mod(n)
            val b = ByteBuffer.allocate(4 + 4 + 256 + 256 + 4).order(ByteOrder.LITTLE_ENDIAN)
            b.putInt(mots).putInt(n0inv.toInt())
            b.put(petitBoutiste(n, 256)).put(petitBoutiste(rr, 256)).putInt(pub.publicExponent.toInt())
            return (Base64.getEncoder().encodeToString(b.array()) + " telephonie-crm@pixel\u0000").toByteArray()
        }

        /** Empreinte MD5 de la clé, telle que le dialogue « Autoriser le débogage » l'affiche. */
        fun empreinte(): String {
            val blob = Base64.getDecoder().decode(publiqueAdb().toString(Charsets.UTF_8).substringBefore(' '))
            return java.security.MessageDigest.getInstance("MD5").digest(blob).joinToString(":") { "%02X".format(it) }
        }

        private fun petitBoutiste(x: BigInteger, taille: Int): ByteArray {
            val grand = x.toByteArray().let { if (it.size > taille) it.copyOfRange(it.size - taille, it.size) else it }
            val sortie = ByteArray(taille)
            for (i in grand.indices) sortie[i] = grand[grand.size - 1 - i]
            return sortie
        }

        fun tls(): SSLContext {
            val certificat = certificat()
            val ks = KeyStore.getInstance("PKCS12").apply { load(null, null) }
            val mdp = CharArray(0)
            ks.setKeyEntry("adb", paire.private, mdp, arrayOf(certificat))
            val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, mdp) }
            // adbd demande un certificat client en nommant des autorités : le gestionnaire par défaut n'offre alors pas
            // notre certificat auto-signé (TLSV1_ALERT_CERTIFICATE_REQUIRED, mesuré le 12/11). On l'offre toujours.
            val defaut = kmf.keyManagers.filterIsInstance<javax.net.ssl.X509KeyManager>().first()
            val toujours = object : javax.net.ssl.X509ExtendedKeyManager() {
                override fun chooseClientAlias(t: Array<out String>?, i: Array<out java.security.Principal>?, s: java.net.Socket?) = "adb"
                override fun chooseEngineClientAlias(t: Array<out String>?, i: Array<out java.security.Principal>?, e: javax.net.ssl.SSLEngine?) = "adb"
                override fun getClientAliases(t: String?, i: Array<out java.security.Principal>?) = arrayOf("adb")
                override fun getServerAliases(t: String?, i: Array<out java.security.Principal>?) = null
                override fun chooseServerAlias(t: String?, i: Array<out java.security.Principal>?, s: java.net.Socket?) = null
                override fun getCertificateChain(a: String?) = defaut.getCertificateChain("adb")
                override fun getPrivateKey(a: String?) = defaut.getPrivateKey("adb")
            }
            val confiance = object : X509TrustManager {
                override fun checkClientTrusted(c: Array<out X509Certificate>?, a: String?) {}
                override fun checkServerTrusted(c: Array<out X509Certificate>?, a: String?) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            }
            return SSLContext.getInstance("TLSv1.3").apply { init(arrayOf(toujours), arrayOf<TrustManager>(confiance), null) }
        }

        /** Certificat X.509 v3 auto-signé minimal (adbd ne vérifie que la clé publique, contre adb_keys). */
        private fun certificat(): X509Certificate {
            val algo = Der.seq(Der.oid("1.2.840.113549.1.1.11"), Der.nul())
            val nom = Der.seq(Der.set(Der.seq(Der.oid("2.5.4.3"), Der.utf8("telephonie-crm"))))
            val tbs = Der.seq(Der.ctx0(Der.entier(BigInteger.valueOf(2))), Der.entier(BigInteger.valueOf(System.currentTimeMillis())),
                algo, nom, Der.seq(Der.temps("250101000000Z"), Der.temps("450101000000Z")), nom, paire.public.encoded)
            val s = Signature.getInstance("SHA256withRSA").apply { initSign(paire.private); update(tbs) }
            val der = Der.seq(tbs, algo, Der.bits(s.sign()))
            return CertificateFactory.getInstance("X.509").generateCertificate(der.inputStream()) as X509Certificate
        }

        companion object {
            val SHA1_DIGESTINFO = byteArrayOf(0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14)
        }
    }

    private object Der {
        fun tlv(tag: Int, contenu: ByteArray): ByteArray {
            val l = contenu.size
            val longueur = when {
                l < 0x80 -> byteArrayOf(l.toByte())
                l < 0x100 -> byteArrayOf(0x81.toByte(), l.toByte())
                l < 0x10000 -> byteArrayOf(0x82.toByte(), (l shr 8).toByte(), l.toByte())
                else -> byteArrayOf(0x83.toByte(), (l shr 16).toByte(), (l shr 8).toByte(), l.toByte())
            }
            return byteArrayOf(tag.toByte()) + longueur + contenu
        }
        fun seq(vararg x: ByteArray) = tlv(0x30, x.fold(ByteArray(0)) { a, b -> a + b })
        fun set(vararg x: ByteArray) = tlv(0x31, x.fold(ByteArray(0)) { a, b -> a + b })
        fun ctx0(x: ByteArray) = tlv(0xa0, x)
        fun entier(x: BigInteger) = tlv(0x02, x.toByteArray())
        fun nul() = byteArrayOf(0x05, 0x00)
        fun utf8(s: String) = tlv(0x0c, s.toByteArray())
        fun temps(s: String) = tlv(0x17, s.toByteArray())
        fun bits(x: ByteArray) = tlv(0x03, byteArrayOf(0) + x)
        fun oid(s: String): ByteArray {
            val p = s.split(".").map { it.toLong() }
            val sortie = ByteArrayOutputStream()
            sortie.write((p[0] * 40 + p[1]).toInt())
            for (v in p.drop(2)) {
                val octets = mutableListOf<Int>()
                var x = v
                octets.add((x and 0x7f).toInt()); x = x shr 7
                while (x > 0) { octets.add(((x and 0x7f) or 0x80).toInt()); x = x shr 7 }
                octets.reversed().forEach { sortie.write(it) }
            }
            return tlv(0x06, sortie.toByteArray())
        }
    }
}

@Suppress("unused")
private fun InputStream.lireTout(): ByteArray = readBytes()
