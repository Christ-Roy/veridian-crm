package site.veridian.telephonie

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import site.veridian.telephonie.contrat.RetourOAuth
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Le CRM refuse l'accès (jeton révoqué, refresh expiré, clé révoquée) : seule une reconnexion débloque. */
class ReconnexionRequise(message: String) : Exception(message)

/**
 * L'accès au CRM : clé API (rôle Téléphone) ou connexion OAuth native de Twenty (enregistrement dynamique de client,
 * RFC 7591, PKCE S256, retour sur 127.0.0.1). Aucun patch de Twenty : `/.well-known/oauth-authorization-server`,
 * `/oauth/register`, `/authorize`, `/oauth/token` sont dans Twenty d'origine (13/11/2026, v2.56 à 2.57).
 *
 * Jeton OAuth : 30 min, refresh 60 jours renouvelé à chaque usage. Un refus du CRM (révocation, refresh expiré)
 * n'est jamais silencieux : la file garde tout, une notification persistante « Reconnecter à Twenty » s'affiche,
 * et tout repart sans doublon après la reconnexion (le plan rapproche par idSource).
 */
class Acces(private val ctx: Context, private val reglages: Reglages) {

    /** En-tête Authorization à jour ; lève ReconnexionRequise ou NonAbouti. */
    @Synchronized
    fun jeton(forcer: Boolean = false): String {
        reglages.reconnexion?.let { throw ReconnexionRequise(it) }
        if (reglages.acces == Reglages.ACCES_CLE) return reglages.cle ?: throw ReconnexionRequise("clé illisible")
        val jeton = reglages.oauthJeton
        if (!forcer && jeton != null && reglages.oauthExpire - System.currentTimeMillis() > 60_000) return jeton
        return renouveler()
    }

    private fun renouveler(): String {
        val url = reglages.url ?: throw ReconnexionRequise("adresse absente")
        val refresh = reglages.oauthRefresh ?: throw signaler("jeton de renouvellement illisible")
        val client = reglages.oauthClient ?: throw signaler("client OAuth absent")
        val (code, corps) = try {
            OAuth.formulaire("$url/oauth/token", mapOf("grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to client))
        } catch (e: IOException) { throw NonAbouti("oauth : ${e.message}", e) }
        if (code in 200..299) {
            val j = JSONObject(corps)
            val nouveau = j.getString("access_token")
            reglages.jetonsRenouveles(nouveau, System.currentTimeMillis() + j.optLong("expires_in", 1800) * 1000,
                j.optString("refresh_token", refresh))
            Journal.log("oauth : jeton renouvelé")
            return nouveau
        }
        // 400/401 avec une erreur OAuth (invalid_grant, invalid_client) : la connexion n'existe plus. 5xx, 429 : non abouti.
        if (code in 400..499 && code != 429) throw signaler("renouvellement refusé (HTTP $code ${JSONObject(corps.ifBlank { "{}" }).optString("error")})")
        throw NonAbouti("oauth : HTTP $code")
    }

    /** Le CRM a répondu 401 avec un jeton qu'on croyait bon : un renouvellement, puis la reconnexion. */
    fun refuse(): String = synchronized(this) {
        if (reglages.acces == Reglages.ACCES_CLE) throw signaler("clé refusée par le CRM (révoquée ?)")
        jeton(forcer = true)
    }

    fun signaler(raison: String): ReconnexionRequise {
        if (reglages.reconnexion == null) {
            reglages.reconnexion = raison
            Journal.log("accès : reconnexion requise ($raison) ; la file attend, rien n'est perdu")
            notifier(ctx, raison)
        }
        return ReconnexionRequise(raison)
    }

    companion object {
        const val CANAL = "reconnexion"
        const val NOTIF = 2

        fun notifier(ctx: Context, raison: String) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CANAL, "Connexion au CRM", NotificationManager.IMPORTANCE_HIGH))
            val ouvrir = PendingIntent.getActivity(ctx, 1, Intent(ctx, AccueilActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
            nm.notify(NOTIF, Notification.Builder(ctx, CANAL).setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Reconnecter à Twenty")
                .setContentText("Les appels et SMS attendent sur le téléphone, rien n'est perdu. Touchez pour vous reconnecter.")
                .setStyle(Notification.BigTextStyle().bigText("Les appels et SMS attendent sur le téléphone, rien n'est perdu. " +
                    "Touchez pour vous reconnecter.\nCause : $raison"))
                .setContentIntent(ouvrir).setOngoing(true).setAutoCancel(false).build())
        }

        fun effacerNotification(ctx: Context) = ctx.getSystemService(NotificationManager::class.java).cancel(NOTIF)
    }
}

/** Le parcours de connexion par le navigateur : un client public par connexion, un serveur local d'un seul retour. */
object OAuth {
    class Session(val url: String, val client: String, val verificateur: String, val etat: String, val retour: String, val serveur: ServerSocket)

    fun formulaire(adresse: String, champs: Map<String, String>): Pair<Int, String> {
        val cnx = URL(adresse).openConnection() as HttpURLConnection
        try {
            cnx.requestMethod = "POST"; cnx.doOutput = true; cnx.connectTimeout = 10_000; cnx.readTimeout = 30_000
            cnx.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            cnx.setRequestProperty("Accept", "application/json")
            cnx.outputStream.use { it.write(champs.entries.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }.toByteArray()) }
            val code = cnx.responseCode
            val flux = if (code in 200..299) cnx.inputStream else cnx.errorStream
            return code to (flux?.use { it.readBytes() }?.toString(Charsets.UTF_8) ?: "")
        } finally { cnx.disconnect() }
    }

    private fun json(adresse: String, corps: JSONObject? = null): JSONObject {
        val cnx = URL(adresse).openConnection() as HttpURLConnection
        try {
            cnx.connectTimeout = 10_000; cnx.readTimeout = 30_000
            cnx.setRequestProperty("Accept", "application/json")
            if (corps != null) {
                cnx.requestMethod = "POST"; cnx.doOutput = true
                cnx.setRequestProperty("Content-Type", "application/json")
                cnx.outputStream.use { it.write(corps.toString().toByteArray()) }
            }
            val code = cnx.responseCode
            val texte = (if (code in 200..299) cnx.inputStream else cnx.errorStream)?.use { it.readBytes() }?.toString(Charsets.UTF_8) ?: ""
            if (code !in 200..299) throw IOException("HTTP $code ${texte.take(200)}")
            return JSONObject(texte)
        } finally { cnx.disconnect() }
    }

    private fun aleatoire(n: Int) = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(n).also { SecureRandom().nextBytes(it) })

    /** Adresse saisie (« monespace.twenty.com », avec ou sans https) → origine https du workspace. */
    fun normaliser(saisie: String): String {
        var s = saisie.trim().trimEnd('/')
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
        val u = Uri.parse(s)
        return "${u.scheme}://${u.authority}"
    }

    /** Étape 1 (fil de travail) : découverte, enregistrement du client, serveur local ; rend l'adresse à ouvrir. */
    fun preparer(url: String): Pair<Session, String> {
        val decouverte = json("$url/.well-known/oauth-authorization-server")
        val serveur = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 15 * 60_000 }
        // Deux adresses de retour sur le même port : voir contrat/RetourOAuth.kt (127.0.0.1 réécrit en localhost
        // par un intermédiaire, « redirectUrl mismatch » à la première connexion au CRM Veridian, 12/11/2026).
        val retour = RetourOAuth.adresse("127.0.0.1", serveur.localPort)
        val client = json(decouverte.getString("registration_endpoint"), JSONObject()
            .put("client_name", "Téléphonie CRM (${android.os.Build.MODEL})")
            .put("redirect_uris", org.json.JSONArray(RetourOAuth.adresses(serveur.localPort)))
            .put("grant_types", org.json.JSONArray().put("authorization_code").put("refresh_token"))
            .put("response_types", org.json.JSONArray().put("code"))
            .put("token_endpoint_auth_method", "none")).getString("client_id")
        val verificateur = aleatoire(48)
        val defi = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verificateur.toByteArray()))
        val etat = aleatoire(16)
        val autorisation = Uri.parse(decouverte.getString("authorization_endpoint")).buildUpon()
            .appendQueryParameter("response_type", "code").appendQueryParameter("client_id", client)
            .appendQueryParameter("redirect_uri", retour).appendQueryParameter("code_challenge", defi)
            .appendQueryParameter("code_challenge_method", "S256").appendQueryParameter("state", etat)
            .appendQueryParameter("scope", "api profile").build().toString()
        return Session(url, client, verificateur, etat, retour, serveur) to autorisation
    }

    /** Étape 2 (fil de travail) : attend le retour du navigateur, échange le code, enregistre les jetons. */
    fun attendre(ctx: Context, s: Session, reglages: Reglages) {
        s.serveur.use { serveur ->
            while (true) {
                val sock = serveur.accept()
                sock.use { c ->
                    val lecteur = c.getInputStream().bufferedReader()
                    val ligne = lecteur.readLine() ?: return@use
                    val chemin = ligne.split(" ").getOrNull(1) ?: ""
                    val entetes = generateSequence { lecteur.readLine()?.takeIf { it.isNotEmpty() } }.take(100).toList()
                    // L'échange reprend l'adresse que le navigateur a réellement appelée (127.0.0.1 ou localhost).
                    val retourAppele = RetourOAuth.appelee(RetourOAuth.host(entetes), s.serveur.localPort)
                    if (!chemin.startsWith("/retour")) { repondre(c, 404, "Introuvable"); return@use }
                    val params = chemin.substringAfter('?', "").split("&").filter { it.contains('=') }
                        .associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
                    val erreur = params["error"]
                    if (erreur != null) { repondre(c, 400, "Connexion refusée : $erreur"); throw IOException("connexion refusée : $erreur") }
                    if (params["state"] != s.etat) { repondre(c, 400, "Réponse inattendue"); throw IOException("état OAuth différent") }
                    val code = params["code"] ?: run { repondre(c, 400, "Code absent"); throw IOException("code absent") }
                    val (http, corps) = formulaire("${s.url}/oauth/token", mapOf("grant_type" to "authorization_code", "code" to code,
                        "client_id" to s.client, "code_verifier" to s.verificateur, "redirect_uri" to retourAppele))
                    if (http !in 200..299) { repondre(c, 400, "Échange refusé"); throw IOException("échange refusé : HTTP $http ${corps.take(200)}") }
                    val j = JSONObject(corps)
                    reglages.enregistrerOAuth(s.url, s.client, j.getString("access_token"),
                        System.currentTimeMillis() + j.optLong("expires_in", 1800) * 1000, j.getString("refresh_token"))
                    Acces.effacerNotification(ctx)
                    repondre(c, 200, "Téléphone connecté à Twenty. Vous pouvez revenir dans l'application Téléphonie CRM.")
                    return
                }
            }
        }
    }

    private fun repondre(c: java.net.Socket, code: Int, texte: String) {
        val retourApp = "intent://ouvrir#Intent;scheme=telephonie-crm;package=site.veridian.telephonie;end"
        val html = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>" +
            "<body style='font-family:sans-serif;padding:24px'><h2>$texte</h2>" +
            "<p><a href='$retourApp' style='font-size:20px'>Revenir à Téléphonie CRM</a></p></body>"
        val octets = html.toByteArray()
        c.getOutputStream().apply {
            write("HTTP/1.1 $code OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${octets.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(octets); flush()
        }
    }
}
