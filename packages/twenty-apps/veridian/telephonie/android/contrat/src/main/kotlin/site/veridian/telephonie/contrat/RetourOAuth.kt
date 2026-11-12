package site.veridian.telephonie.contrat

/**
 * Adresse de retour OAuth de la connexion « Se connecter avec Twenty » (RFC 8252 : serveur local du téléphone).
 *
 * Le client est enregistré (RFC 7591) avec DEUX adresses sur le même port, `127.0.0.1` et `localhost` : un
 * intermédiaire peut réécrire l'une en l'autre sur le chemin du navigateur (vu le 12/11/2026 sur le CRM Veridian,
 * première connexion par le Hub : `127.0.0.1` devenu `localhost`, « redirectUrl mismatch »). L'autorisation part
 * avec `127.0.0.1` ; l'échange du code doit reprendre l'adresse que le navigateur a réellement appelée, que l'on
 * lit dans l'en-tête `Host` de la requête reçue sur le port local.
 */
object RetourOAuth {
    fun adresses(port: Int): List<String> = listOf(adresse("127.0.0.1", port), adresse("localhost", port))

    fun adresse(hote: String, port: Int) = "http://$hote:$port/retour"

    /** Adresse appelée, d'après l'en-tête Host (« localhost:43117 », « 127.0.0.1:43117 », absent). */
    fun appelee(enTeteHost: String?, port: Int): String {
        val hote = enTeteHost?.trim()?.lowercase()?.substringBefore(':') ?: ""
        return adresse(if (hote == "localhost") "localhost" else "127.0.0.1", port)
    }

    /** En-tête Host parmi les lignes d'en-tête d'une requête HTTP/1.1 (nom insensible à la casse). */
    fun host(lignes: List<String>): String? =
        lignes.firstOrNull { it.substringBefore(':').trim().equals("host", ignoreCase = true) }?.substringAfter(':')?.trim()
}
