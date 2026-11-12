package site.veridian.telephonie

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * La file persistante. Un événement lu sur le téléphone y entre (table `file`) avant tout appel réseau : un arrêt
 * brutal, un manque de mémoire ou l'absence de réseau ne perd rien. Il en sort quand un plan contre le CRM ne
 * donne plus rien à faire ; son empreinte va alors dans `synchro` (déjà porté tel quel, on ne le replanifie pas).
 * Les fichiers à téléverser ont leur propre table, vidée par leurs propres fils.
 */
class Base(ctx: Context) : SQLiteOpenHelper(ctx, "telephonie.db", null, 1) {
    init { setWriteAheadLoggingEnabled(true) }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE file (pluriel TEXT NOT NULL, idSource TEXT NOT NULL, flux TEXT NOT NULL,
            voulu TEXT NOT NULL, empreinte TEXT NOT NULL, evenement REAL, essais INTEGER NOT NULL DEFAULT 0,
            prochain INTEGER NOT NULL DEFAULT 0, ajoute INTEGER NOT NULL, signale INTEGER,
            PRIMARY KEY (pluriel, idSource))""")
        db.execSQL("""CREATE TABLE synchro (pluriel TEXT NOT NULL, idSource TEXT NOT NULL, empreinte TEXT NOT NULL,
            e164 TEXT, flux TEXT, maj INTEGER NOT NULL, PRIMARY KEY (pluriel, idSource))""")
        db.execSQL("CREATE INDEX synchro_e164 ON synchro (e164)")
        db.execSQL("""CREATE TABLE televersements (id INTEGER PRIMARY KEY AUTOINCREMENT, pluriel TEXT NOT NULL,
            recordId TEXT NOT NULL, idSource TEXT NOT NULL, champ TEXT NOT NULL, chemins TEXT NOT NULL,
            essais INTEGER NOT NULL DEFAULT 0, prochain INTEGER NOT NULL DEFAULT 0, UNIQUE (pluriel, recordId, champ))""")
        db.execSQL("CREATE TABLE kv (cle TEXT PRIMARY KEY, valeur TEXT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, ancienne: Int, nouvelle: Int) {}

    data class Element(val pluriel: String, val idSource: String, val flux: String, val voulu: String,
                       val empreinte: String, val evenement: Double?, val essais: Int, val signale: Long?)

    // ------------------------------------------------------------ file

    /** Ajoute ou remplace ; rend faux si l'empreinte est déjà portée au CRM (rien à faire). */
    @Synchronized
    fun enfiler(pluriel: String, idSource: String, flux: String, voulu: String, empreinte: String, evenement: Double?,
                signale: Long?): Boolean {
        val db = writableDatabase
        db.rawQuery("SELECT 1 FROM synchro WHERE pluriel=? AND idSource=? AND empreinte=?",
            arrayOf(pluriel, idSource, empreinte)).use { if (it.moveToFirst()) return false }
        db.rawQuery("SELECT empreinte FROM file WHERE pluriel=? AND idSource=?", arrayOf(pluriel, idSource)).use {
            if (it.moveToFirst() && it.getString(0) == empreinte) return true
        }
        db.insertWithOnConflict("file", null, ContentValues().apply {
            put("pluriel", pluriel); put("idSource", idSource); put("flux", flux); put("voulu", voulu)
            put("empreinte", empreinte); put("evenement", evenement); put("essais", 0); put("prochain", 0)
            put("ajoute", System.currentTimeMillis()); put("signale", signale)
        }, SQLiteDatabase.CONFLICT_REPLACE)
        return true
    }

    @Synchronized
    fun prets(maintenant: Long, limite: Int = 500): List<Element> =
        readableDatabase.rawQuery("SELECT pluriel, idSource, flux, voulu, empreinte, evenement, essais, signale FROM file " +
            "WHERE prochain <= ? ORDER BY ajoute LIMIT ?", arrayOf(maintenant.toString(), limite.toString())).use { c ->
            buildList { while (c.moveToNext()) add(Element(c.getString(0), c.getString(1), c.getString(2), c.getString(3),
                c.getString(4), if (c.isNull(5)) null else c.getDouble(5), c.getInt(6), if (c.isNull(7)) null else c.getLong(7))) }
        }

    @Synchronized
    fun prochainEssai(): Long? = readableDatabase.rawQuery("SELECT MIN(prochain) FROM file", null).use {
        if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null
    }

    @Synchronized
    fun taille(table: String = "file"): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM $table", null).use { it.moveToFirst(); it.getInt(0) }

    /** Porté au CRM tel quel : sort de la file, son empreinte est gardée (seulement si elle n'a pas changé entre-temps). */
    @Synchronized
    fun termine(e: Element, e164: String?) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("file", "pluriel=? AND idSource=? AND empreinte=?", arrayOf(e.pluriel, e.idSource, e.empreinte))
            db.insertWithOnConflict("synchro", null, ContentValues().apply {
                put("pluriel", e.pluriel); put("idSource", e.idSource); put("empreinte", e.empreinte); put("e164", e164)
                put("flux", e.flux); put("maj", System.currentTimeMillis())
            }, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    @Synchronized
    fun reporter(e: Element, delaiMs: Long, compterEssai: Boolean) {
        writableDatabase.execSQL("UPDATE file SET prochain=?, essais=essais+? WHERE pluriel=? AND idSource=?",
            arrayOf(System.currentTimeMillis() + delaiMs, if (compterEssai) 1 else 0, e.pluriel, e.idSource))
    }

    /** Les enregistrements déjà portés dont le numéro vient d'apparaître dans le CRM : à replanifier (rattachement). */
    @Synchronized
    fun oublierNumeros(numeros: Collection<String>): Int {
        var n = 0
        for (lot in numeros.chunked(500)) {
            n += writableDatabase.delete("synchro", "e164 IN (${lot.joinToString(",") { "?" }})", lot.toTypedArray())
        }
        return n
    }

    /** (pluriel, idSource, maj) de tout ce qui est porté : la comparaison du mode miroir. */
    @Synchronized
    fun exporterSynchro(f: java.io.File) {
        readableDatabase.rawQuery("SELECT pluriel, idSource, maj FROM synchro", null).use { c ->
            f.bufferedWriter().use { w -> while (c.moveToNext()) w.write("${c.getString(0)}\t${c.getString(1)}\t${c.getLong(2)}\n") }
        }
    }

    @Synchronized
    fun oublierTout() { writableDatabase.delete("synchro", null, null) }

    // ------------------------------------------------------------ téléversements

    data class Televersement(val id: Long, val pluriel: String, val recordId: String, val idSource: String,
                             val champ: String, val chemins: List<String>, val essais: Int)

    @Synchronized
    fun ajouterTeleversement(pluriel: String, recordId: String, idSource: String, champ: String, chemins: List<String>) {
        writableDatabase.insertWithOnConflict("televersements", null, ContentValues().apply {
            put("pluriel", pluriel); put("recordId", recordId); put("idSource", idSource); put("champ", champ)
            put("chemins", Json.texte(chemins))
        }, SQLiteDatabase.CONFLICT_IGNORE)
    }

    @Synchronized
    fun televersementEnAttente(pluriel: String, idSource: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM televersements WHERE pluriel=? AND idSource=?", arrayOf(pluriel, idSource))
            .use { it.moveToFirst() }

    @Synchronized
    fun prochainTeleversement(audio: Boolean, maintenant: Long): Televersement? =
        readableDatabase.rawQuery("SELECT id, pluriel, recordId, idSource, champ, chemins, essais FROM televersements " +
            "WHERE prochain <= ? AND champ ${if (audio) "=" else "!="} 'enregistrement' ORDER BY id LIMIT 1",
            arrayOf(maintenant.toString())).use { c ->
            if (!c.moveToFirst()) null else Televersement(c.getLong(0), c.getString(1), c.getString(2), c.getString(3),
                c.getString(4), (Json.versKotlin(org.json.JSONArray(c.getString(5))) as List<*>).map { it as String }, c.getInt(6))
        }

    @Synchronized
    fun televersementFait(id: Long) { writableDatabase.delete("televersements", "id=?", arrayOf(id.toString())) }

    @Synchronized
    fun televersementReporte(id: Long, delaiMs: Long) {
        writableDatabase.execSQL("UPDATE televersements SET prochain=?, essais=essais+1 WHERE id=?",
            arrayOf(System.currentTimeMillis() + delaiMs, id))
    }

    /** Attente du Wi-Fi : reporté sans compter un essai de plus. */
    @Synchronized
    fun televersementAttendWifi(id: Long, delaiMs: Long) {
        writableDatabase.execSQL("UPDATE televersements SET prochain=? WHERE id=?", arrayOf(System.currentTimeMillis() + delaiMs, id))
    }

    /** Le Wi-Fi est là : tout fichier en attente repart maintenant. */
    @Synchronized
    fun televersementsLibres() { writableDatabase.execSQL("UPDATE televersements SET prochain=0") }

    /** Remet l'élément en tête de file (vérification après un téléversement, transcription prête). */
    @Synchronized
    fun reveiller(pluriel: String, idSource: String) {
        writableDatabase.execSQL("UPDATE file SET prochain=0 WHERE pluriel=? AND idSource=?", arrayOf(pluriel, idSource))
    }

    // ------------------------------------------------------------ clés et valeurs

    @Synchronized
    fun lire(cle: String): String? = readableDatabase.rawQuery("SELECT valeur FROM kv WHERE cle=?", arrayOf(cle)).use {
        if (it.moveToFirst()) it.getString(0) else null
    }

    @Synchronized
    fun ecrire(cle: String, valeur: String?) {
        writableDatabase.insertWithOnConflict("kv", null, ContentValues().apply { put("cle", cle); put("valeur", valeur) },
            SQLiteDatabase.CONFLICT_REPLACE)
    }

    companion object {
        @Volatile private var instance: Base? = null
        fun de(ctx: Context): Base = instance ?: synchronized(this) { instance ?: Base(ctx.applicationContext).also { instance = it } }
    }
}
