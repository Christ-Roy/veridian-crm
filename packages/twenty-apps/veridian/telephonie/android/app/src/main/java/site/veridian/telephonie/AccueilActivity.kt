package site.veridian.telephonie

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.File

/**
 * L'écran de l'app, pour n'importe qui : connexion à son Twenty (navigateur ou clé API, collée ou scannée),
 * test de la connexion (lecture et droit d'écrire, sans rien écrire), autorisations Android, passage explicite du
 * mode essai à l'envoi, options (transcription, enregistrements JemRec, messagerie vocale), état et journal.
 */
class AccueilActivity : Activity() {
    private lateinit var reglages: Reglages
    private lateinit var racine: LinearLayout
    private val ui = Handler(Looper.getMainLooper())
    private var champUrl: EditText? = null
    private var champCle: EditText? = null
    private var resultatTest: String? = null
    private var occupe: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reglages = Reglages(this)
        racine = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(24), dp(18), dp(32)) }
        setContentView(ScrollView(this).apply { addView(racine) })
        lireLien(intent)
        ServiceSynchro.demarrer(this, origine = "écran")
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); lireLien(intent); afficher() }
    override fun onResume() { super.onResume(); afficher(); ui.postDelayed(rafraichir, 3000) }
    override fun onPause() { super.onPause(); ui.removeCallbacks(rafraichir) }

    private val rafraichir = object : Runnable {
        override fun run() { if (occupe == null && !saisieEnCours()) afficher(); ui.postDelayed(this, 3000) }
    }

    private fun saisieEnCours() = champUrl?.hasFocus() == true || champCle?.hasFocus() == true

    /** telephonie-crm://connecter?url=…&cle=… (QR scanné par l'appareil photo) : champs pré-remplis, jamais enregistrés seuls. */
    private fun lireLien(i: Intent?) {
        val texte = i?.dataString ?: return
        if (texte.startsWith("telephonie-crm://connecter")) lireConfig(texte)?.let { (u, c) -> pre = u to c }
    }

    private var pre: Pair<String?, String?>? = null

    // ------------------------------------------------------------------ affichage

    private fun afficher() {
        val urlSaisie = champUrl?.text?.toString(); val cleSaisie = champCle?.text?.toString()
        racine.removeAllViews()
        titre("Téléphonie CRM", 24f)
        texte("Vos appels et SMS dans votre Twenty, envoyés par le téléphone lui-même. Version ${version()}.", petit = true)

        reglages.reconnexion?.let {
            bandeau("Reconnexion à Twenty nécessaire. Les appels et SMS attendent sur le téléphone, rien n'est perdu. ($it)")
        }

        // 1. connexion
        section("1. Connexion à votre Twenty")
        if (reglages.configure) {
            texte("Connecté à ${reglages.url} (" + (if (reglages.acces == Reglages.ACCES_OAUTH) "connexion par le navigateur" else "clé API") + ")")
        }
        champUrl = champ("Adresse de votre Twenty (ex. monentreprise.twenty.com)", urlSaisie ?: pre?.first ?: reglages.url ?: "", motDePasse = false)
        bouton(if (reglages.configure) "Se reconnecter avec Twenty (navigateur)" else "Se connecter avec Twenty (navigateur)") { connecterNavigateur() }
        texte("Ou, pour un accès limité aux appels et SMS : une clé API au rôle « Téléphone », créée dans Twenty " +
            "(Paramètres, API et webhooks, Créer une clé, rôle Téléphone).", petit = true)
        champCle = champ("Clé API (collée ou scannée)", cleSaisie ?: pre?.second ?: "", motDePasse = true)
        rangee(Button(this).apply { text = "Scanner un QR"; setOnClickListener { scanner() } },
            Button(this).apply { text = "Coller"; setOnClickListener { coller() } })
        bouton("Tester la connexion") { tester() }
        occupe?.let { texte(it, gras = true) }
        resultatTest?.let { texte(it) }

        // 2. autorisations
        section("2. Autorisations du téléphone")
        val manquantes = permissionsManquantes()
        texte(if (manquantes.isEmpty()) "Journal d'appels, SMS, contacts, état d'appel, notifications : accordées ✓"
            else "À accorder : " + manquantes.joinToString(", ") { NOMS[it] ?: it })
        if (manquantes.isNotEmpty()) bouton("Accorder les autorisations") { demanderPermissions() }
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName)) bouton("Ne pas endormir l'app (batterie)") {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } else texte("Batterie : l'app n'est pas endormie ✓", petit = true)

        // 3. envoi
        section("3. Envoi au CRM")
        val ecriture = !reglages.miroir
        texte(if (ecriture) "Envoi actif : chaque appel, SMS et MMS part au CRM dans les secondes qui suivent."
            else "Mode essai : l'app lit et prépare tout, mais n'écrit rien dans le CRM.")
        interrupteur("Envoyer au CRM", ecriture, actif = reglages.configure && reglages.reconnexion == null) { v -> basculerEnvoi(v) }

        // 4. options
        section("4. Options (facultatives)")
        interrupteur("Transcrire les appels enregistrés, sur le téléphone", reglages.transcriptionVoulue) { v -> basculerTranscription(v) }
        texte("Modèle Parakeet (640 Mo, téléchargé en Wi-Fi) : ${Modele.etat(this)}", petit = true)
        if (reglages.jemrecPresent) texte("Enregistrements d'appels : JemRec détecté (${reglages.jemrec.path}) ✓", petit = true)
        else {
            texte("Enregistrements d'appels : JemRec non détecté. Facultatif : installez JemRec (F-Droid), puis autorisez " +
                "l'accès aux fichiers ci-dessous ; les enregistrements partiront avec leurs appels.", petit = true)
        }
        if (!Environment.isExternalStorageManager()) bouton("Autoriser l'accès aux fichiers (enregistrements)") {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
        }
        interrupteur("Messagerie vocale (avancé)", reglages.messagerieActive) { v ->
            reglages.poserDrapeau("messagerie", v); if (v) aideMessagerie(); Synchro.de(this).signaler(Synchro.Flux.MESSAGERIE); afficher()
        }
        if (reglages.messagerieActive) {
            val s = Synchro.de(this)
            texte("Messagerie : ${s.adb.etat}", petit = true)
            bouton("Comment activer la messagerie vocale") { aideMessagerie() }
        }

        // 5. état
        section("État")
        val s = Synchro.de(this)
        texte("Appareil : ${Build.MODEL} (enregistré comme ${reglages.appareil})\nEn file : ${s.base.taille()} · fichiers : ${s.base.taille("televersements")}", petit = true)
        val delais = File(filesDir, "delais.tsv").takeIf { it.exists() }?.readLines()?.takeLast(5)?.joinToString("\n") ?: "aucun"
        val journal = File(filesDir, "journal.log").takeIf { it.exists() }?.readLines()?.takeLast(15)?.joinToString("\n") ?: ""
        texte("Derniers délais (s) :\n$delais\n\nJournal :\n$journal", petit = true, mono = true)
    }

    // ------------------------------------------------------------------ connexion

    private fun urlSaisie(): String? = champUrl?.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { OAuth.normaliser(it) }

    private fun connecterNavigateur() {
        val url = urlSaisie() ?: return toast("Indiquez l'adresse de votre Twenty")
        occupe = "Ouverture de la connexion…"; afficher()
        Thread {
            try {
                val (session, adresse) = OAuth.preparer(url)
                ui.post { occupe = "Connectez-vous dans le navigateur, puis revenez ici."; afficher()
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(adresse))) }
                OAuth.attendre(this, session, reglages)
                val bilan = verifier(Twenty(url, Synchro.de(this).acces))
                Synchro.de(this).reconnecte()
                ui.post { occupe = null; resultatTest = "Connecté par le navigateur.\n$bilan"; afficher()
                    startActivity(Intent(this, AccueilActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
            } catch (e: Exception) {
                Journal.erreur("connexion par le navigateur", e)
                ui.post { occupe = null; resultatTest = "Connexion non aboutie : ${e.message}"; afficher() }
            }
        }.start()
    }

    private fun tester() {
        val cle = champCle?.text?.toString()?.trim().orEmpty()
        val url = urlSaisie()
        occupe = "Test en cours…"; afficher()
        Thread {
            val texte = try {
                if (cle.isNotEmpty()) {
                    url ?: throw IllegalStateException("indiquez l'adresse de votre Twenty")
                    val bilan = verifier(Twenty(url, cle))
                    if (bilan.startsWith("✓")) {
                        reglages.enregistrerCle(url, cle)
                        Synchro.de(this).reconnecte()
                        "Clé enregistrée (chiffrée sur le téléphone).\n$bilan"
                    } else bilan
                } else if (reglages.configure) verifier(Twenty(reglages.url!!, Synchro.de(this).acces))
                else "Connectez-vous d'abord (navigateur ou clé API)."
            } catch (e: Exception) { "Test non abouti : ${e.message}" }
            ui.post { occupe = null; resultatTest = texte; ui.post { champCle?.setText("") }; afficher() }
        }.start()
    }

    /** Prouve la lecture et le droit d'écrire sur Appels et SMS sans rien écrire : une modification d'un identifiant
     *  inexistant rend 404 si l'écriture est permise, 403 sinon (mesuré le 13/11/2026 sur le staging). */
    private fun verifier(tw: Twenty): String {
        val lignes = mutableListOf<String>()
        var ok = true
        fun code(e: Exception) = Regex("HTTP (\\d{3})").find(e.message ?: "")?.groupValues?.get(1)?.toInt()
        fun lecture(nom: String, chemin: String) = try { tw.requete("GET", chemin); lignes += "✓ $nom" } catch (e: Refus) {
            ok = false
            lignes += when {
                code(e) == 400 && e.message!!.contains("not found") -> "✗ $nom : l'app Téléphonie n'est pas installée dans ce Twenty"
                code(e) == 403 -> "✗ $nom : droit de lecture refusé"
                else -> "✗ $nom : ${e.message}"
            }
        }
        fun ecriture(nom: String, pluriel: String) = try {
            tw.requete("PATCH", "/rest/$pluriel/00000000-0000-4000-8000-000000000000", emptyMap<String, Any>()); lignes += "✓ $nom"
        } catch (e: Refus) {
            if (code(e) == 404) lignes += "✓ $nom" else { ok = false; lignes += "✗ $nom : ${if (code(e) == 403) "droit d'écriture refusé" else e.message}" }
        }
        lecture("Lecture des personnes", "/rest/people?limit=1")
        lecture("Objet Appels présent", "/rest/appels?limit=1")
        lecture("Objet SMS présent", "/rest/textMessages?limit=1")
        ecriture("Droit d'écrire les appels", "appels")
        ecriture("Droit d'écrire les SMS", "textMessages")
        return (if (ok) "✓ Connexion prête" else "✗ Connexion incomplète") + "\n" + lignes.joinToString("\n")
    }

    private fun scanner() {
        com.google.zxing.integration.android.IntentIntegrator(this)
            .setDesiredBarcodeFormats(com.google.zxing.integration.android.IntentIntegrator.QR_CODE)
            .setPrompt("Scannez le QR de connexion").setBeepEnabled(false).setOrientationLocked(false).initiateScan()
    }

    @Deprecated("Activity sans AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val r = com.google.zxing.integration.android.IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (r?.contents != null) {
            val (u, c) = lireConfig(r.contents) ?: return toast("QR non reconnu")
            pre = (u ?: champUrl?.text?.toString()) to c
            champUrl?.setText(pre?.first ?: ""); champCle?.setText(c ?: "")
            toast("QR lu : touchez « Tester la connexion »")
            return
        }
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    }

    private fun coller() {
        val texte = getSystemService(ClipboardManager::class.java).primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
            ?: return toast("Presse-papiers vide")
        val (u, c) = lireConfig(texte) ?: return toast("Rien de reconnu")
        if (u != null) champUrl?.setText(u)
        if (c != null) champCle?.setText(c)
    }

    // ------------------------------------------------------------------ autorisations

    private fun permissionsVoulues() = listOfNotNull(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_SMS,
        Manifest.permission.RECEIVE_SMS, Manifest.permission.RECEIVE_MMS, Manifest.permission.READ_CONTACTS,
        Manifest.permission.READ_PHONE_STATE,
        if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else null)

    private fun permissionsManquantes() = permissionsVoulues().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    private fun demanderPermissions() = requestPermissions(permissionsManquantes().toTypedArray(), 7)

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val refusees = permissionsManquantes()
        // Le service relit tout : ses observateurs et sa lecture d'état d'appel ont besoin des autorisations.
        stopService(Intent(this, ServiceSynchro::class.java)); ServiceSynchro.demarrer(this, origine = "autorisations")
        if (refusees.isNotEmpty() && refusees.none { shouldShowRequestPermissionRationale(it) }) {
            AlertDialog.Builder(this).setTitle("Autorisations bloquées par Android")
                .setMessage("Android bloque le journal d'appels et les SMS pour une app installée hors Play Store. " +
                    "Dans l'écran qui va s'ouvrir : menu ⋮ en haut à droite, « Autoriser les paramètres restreints », " +
                    "puis Autorisations, et accordez Journal d'appels, SMS, Contacts et Téléphone. Revenez ensuite ici.")
                .setPositiveButton("Ouvrir") { _, _ ->
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }.setNegativeButton("Plus tard", null).show()
        }
        afficher()
    }

    // ------------------------------------------------------------------ envoi, options

    private fun basculerEnvoi(actif: Boolean) {
        if (!actif) {
            AlertDialog.Builder(this).setTitle("Repasser en mode essai ?").setMessage("Plus rien ne sera écrit dans le CRM.")
                .setPositiveButton("Mode essai") { _, _ -> reglages.mode = "miroir"; ServiceSynchro.demarrer(this, origine = "écran"); afficher() }
                .setNegativeButton("Annuler") { _, _ -> afficher() }.setOnCancelListener { afficher() }.show()
            return
        }
        val choix = arrayOf("Tout l'historique du téléphone", "Les 30 derniers jours", "À partir de maintenant")
        AlertDialog.Builder(this).setTitle("Envoyer au CRM depuis quand ?").setItems(choix) { _, i ->
            val depuis = when (i) { 0 -> 0L; 1 -> System.currentTimeMillis() - 30L * 86_400_000; else -> System.currentTimeMillis() - 60_000 }
            reglages.poserTexte("historique_depuis_ms", depuis.toString())
            val s = Synchro.de(this)
            reglages.mode = "ecriture"
            s.base.oublierTout(); s.signalerTout(complet = true)
            ServiceSynchro.demarrer(this, origine = "écran")
            Journal.log("envoi activé depuis l'écran (${choix[i]})")
            afficher()
        }.setOnCancelListener { afficher() }.show()
    }

    private fun basculerTranscription(actif: Boolean) {
        reglages.poserDrapeau("transcription", actif)
        if (actif && !reglages.modele.exists()) {
            AlertDialog.Builder(this).setTitle("Télécharger le modèle ?")
                .setMessage("La transcription se fait sur le téléphone, sans rien envoyer à un service extérieur. " +
                    "Elle demande un modèle de 640 Mo, téléchargé une fois, en Wi-Fi seulement (Hugging Face, somme vérifiée).")
                .setPositiveButton("Télécharger") { _, _ -> toast(Modele.lancer(this)); afficher() }
                .setNegativeButton("Plus tard") { _, _ -> afficher() }.show()
        } else afficher()
    }

    private fun aideMessagerie() {
        val commandes = "pkg install -y android-tools\nadb pair 127.0.0.1:PORT_D_APPAIRAGE CODE\nadb connect 127.0.0.1:PORT\nadb tcpip 5555"
        AlertDialog.Builder(this).setTitle("Messagerie vocale (avancé)")
            .setMessage("Android réserve la messagerie vocale aux apps système. L'app la lit par le débogage du téléphone " +
                "lui-même, sans ordinateur :\n\n1. Réglages, À propos du téléphone : touchez 7 fois « Numéro de build ».\n" +
                "2. Réglages, Système, Options pour les développeurs : activez « Débogage sans fil ».\n" +
                "3. Installez Termux (F-Droid), ouvrez-le, et tapez les commandes copiées par le bouton ci-dessous " +
                "(PORT et CODE : « Associer l'appareil avec un code »).\n" +
                "4. Revenez ici : une fenêtre « Autoriser le débogage ? » apparaît, cochez « Toujours autoriser ».\n\n" +
                "Ensuite l'app rouvre seule l'accès après chaque redémarrage (en Wi-Fi). Tout le reste fonctionne sans cette option.")
            .setPositiveButton("Copier les commandes") { _, _ ->
                getSystemService(ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText("commandes", commandes))
                toast("Commandes copiées")
            }.setNegativeButton("Fermer", null).show()
    }

    // ------------------------------------------------------------------ petites briques

    private fun version() = packageManager.getPackageInfo(packageName, 0).versionName
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()

    private fun titre(t: String, taille: Float) = racine.addView(TextView(this).apply { text = t; textSize = taille; setTypeface(typeface, Typeface.BOLD) })
    private fun section(t: String) = racine.addView(TextView(this).apply {
        text = t; textSize = 18f; setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(22), 0, dp(6)) })
    private fun texte(t: String, petit: Boolean = false, gras: Boolean = false, mono: Boolean = false) = racine.addView(TextView(this).apply {
        text = t; textSize = if (petit) 13f else 15f; setPadding(0, dp(4), 0, dp(4)); setTextIsSelectable(true)
        if (gras) setTypeface(typeface, Typeface.BOLD); if (mono) typeface = Typeface.MONOSPACE })
    private fun bandeau(t: String) = racine.addView(TextView(this).apply {
        text = t; textSize = 15f; setPadding(dp(12), dp(12), dp(12), dp(12)); setBackgroundColor(0xFFFFE0B2.toInt()); setTextColor(0xFF5D2E00.toInt()) })
    private fun bouton(t: String, action: () -> Unit) = racine.addView(Button(this).apply { text = t; isAllCaps = false; setOnClickListener { action() } })
    private fun rangee(vararg vues: View) = racine.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        vues.forEach { addView(it, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)) } })
    private fun champ(indice: String, valeur: String, motDePasse: Boolean) = EditText(this).apply {
        hint = indice; setText(valeur); isSingleLine = true
        inputType = if (motDePasse) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
    }.also { racine.addView(it) }
    private fun interrupteur(t: String, coche: Boolean, actif: Boolean = true, action: (Boolean) -> Unit) = racine.addView(Switch(this).apply {
        text = t; textSize = 15f; isChecked = coche; isEnabled = actif; setPadding(0, dp(8), 0, dp(8))
        setOnCheckedChangeListener { _, v -> action(v) } })

    companion object {
        val NOMS = mapOf(Manifest.permission.READ_CALL_LOG to "journal d'appels", Manifest.permission.READ_SMS to "SMS",
            Manifest.permission.RECEIVE_SMS to "réception des SMS", Manifest.permission.RECEIVE_MMS to "réception des MMS",
            Manifest.permission.READ_CONTACTS to "contacts", Manifest.permission.READ_PHONE_STATE to "état d'appel",
            "android.permission.POST_NOTIFICATIONS" to "notifications")

        /** Une configuration collée ou scannée : JSON {url, cle}, lien telephonie-crm://connecter?url=&cle=, ou une clé seule. */
        fun lireConfig(brut: String): Pair<String?, String?>? {
            val t = brut.trim()
            if (t.isEmpty()) return null
            if (t.startsWith("{")) return try {
                val j = JSONObject(t)
                (j.optString("url").ifEmpty { null }) to (listOf("cle", "key", "apiKey").map { j.optString(it) }.firstOrNull { it.isNotEmpty() })
            } catch (_: Exception) { null }
            if (t.startsWith("telephonie-crm:")) {
                val u = Uri.parse(if (t.contains("://")) t else t.replaceFirst(":", "://"))
                return u.getQueryParameter("url") to (u.getQueryParameter("cle") ?: u.getQueryParameter("key"))
            }
            if (t.startsWith("http://") || t.startsWith("https://")) return t to null
            if (t.matches(Regex("^[A-Za-z0-9._\\-]{20,}$"))) return null to t
            return null
        }
    }
}
