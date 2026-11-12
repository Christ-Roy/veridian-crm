package site.veridian.telephonie

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/** Un écran de lecture seule : mode, file, adb, derniers délais et dernières lignes du journal. */
class EtatActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ServiceSynchro.demarrer(this, origine = "écran")
        val s = Synchro.de(this)
        val delais = File(filesDir, "delais.tsv").takeIf { it.exists() }?.readLines()?.takeLast(10)?.joinToString("\n") ?: "aucun"
        val journal = File(filesDir, "journal.log").takeIf { it.exists() }?.readLines()?.takeLast(40)?.joinToString("\n") ?: ""
        val texte = "Mode : ${s.reglages.mode}\nEn file : ${s.base.taille()} · fichiers : ${s.base.taille("televersements")}\n" +
            "Messagerie (adb) : ${s.adb.etat}\nModèle : ${if (s.reglages.modele.exists()) "présent" else "absent"}\n\n" +
            "Derniers délais (s) :\n$delais\n\nJournal :\n$journal"
        setContentView(ScrollView(this).apply { addView(TextView(this@EtatActivity).apply { text = texte; setPadding(32, 48, 32, 32); textSize = 12f }) })
    }
}
