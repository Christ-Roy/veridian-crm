# Téléphonie Veridian (plugin Veridian du CRM, app Twenty)

Les appels, SMS et MMS de Robert dans la fiche de chaque personne du CRM : timeline, onglets Appels et SMS,
enregistrements lisibles sur place, transcriptions, pièces jointes. Le téléphone les envoie lui-même.

## Reproduire de zéro (une machine, un workspace, un téléphone)

```bash
install -m 755 packages/twenty-apps/veridian/telephonie/bin/crm-telephonie ~/.local/bin/   # une fois par machine
crm-telephonie installer --env prod --workspace veridian-4                                 # tout, rejouable
```

Le lanceur s'amorce seul (clone partiel du plugin à `origin/staging`, Node 24) et `installer` enchaîne, chaque
étape idempotente, arrêt à la première qui échoue :

1. **app Twenty** : objets `appel` et `textMessage`, relations Person, types de timeline, onglets, vues, rôle
   « Téléphone » (`app apply --no-prune`) ;
2. **dossier People** : une entrée par valeur du champ `etiquette` de Person ;
3. **historique** : journal et SMS du Pixel, enregistrements, sauvegarde du Galaxy S10e (`--sans-historique` pour sauter) ;
4. **téléphone** : clé API du rôle Téléphone, puis agent Termux, services, démarrage au boot (`--sans-telephone`).

Prérequis, hors plugin : la clé Admin du workspace sur le bastion (`twenty-admin --env <env> agent:grant <ws>`,
skill `twenty-cli`), l'accès `ssh pixel` / `pixel shell` au téléphone (skill `android`), Termux:Boot ouvert une
fois à la main sur le téléphone. Côté CRM, deux patchs du front vivent hors du plugin, car une app ne peut pas
changer le code de Twenty : `twenty-front/src/modules/veridian-audio/` (l'audio se lit dans l'aperçu au lieu
d'être téléchargé) et `veridian-brand/getVeridianSystemAuthorFullName.ts` (pas de « Twenty » devant les lignes).
Ils sont dans l'image du CRM, inscrits dans `VERIDIAN-PATCHES.md` et gardés par `scripts/ci/patch-survival.sh`.

| Dossier | Contenu |
|---|---|
| `src/` | l'app Twenty (SDK) : objets, champs, relations, timeline, vues, onglets, rôles |
| `ingestion/crm_telephonie.py` | CLI : installer, ingerer, app, dossier, telephone |
| `ingestion/telephone.py` | agent du Pixel (Termux) |
| `ingestion/installation_telephone.py`, `ingestion/barre_laterale.py` | installation du téléphone, dossier People |
| `ingestion/tests/` | tests sans réseau (CI, job `app-telephonie`) |
| `bin/crm-telephonie` | lanceur à copier dans `~/.local/bin` |

## Ce que l'app installe

| Entité | Rôle |
|---|---|
| objet `appel` (Appels) | direction (dont **Messagerie** : un message vocal), canal (téléphone, WhatsApp, Telegram), début, durée, numéro, nom sur le téléphone, **enregistrement** (champ FILES, stockage de Twenty), **transcription**, **transcrit par** (`sourceTranscription` : Google, Parakeet, Whisper) et **modèle de transcription** (`moteurTranscription`, par exemple `parakeet-tdt-0.6b-v3-q8_0`), appareil, `idSource` unique |
| objet `textMessage` (SMS et messages) | sens, canal (SMS, MMS, WhatsApp, Telegram), date, texte, aperçu, numéro, pièces jointes (FILES), appareil, `idSource` unique |
| relations `person` ↔ `appels` / `textMessages` | rattachement à une personne, `SET_NULL` si la personne est supprimée |
| types d'activité `appelLinked`, `textMessageLinked` | Twenty écrit seul la ligne sur la timeline de la personne au rattachement, **ancrée à la date de l'appel ou du message** (`happensAtFieldUniversalIdentifier`), pas au moment de l'import |
| onglets **Appels** et **SMS** de la fiche Person (après Calendar) | la relation en tableau (titre, début, enregistrement, transcription ; aperçu, date, canal), du plus récent au plus ancien, filtrée sur la fiche courante (`isCurrentRecordSelected`) |

Aucun patch du fork, aucune fonction serveur (le code client est coupé chez Veridian) : uniquement le mécanisme
natif des apps de Twenty v2.56 (`twenty-sdk`). Le rôle par défaut n'accorde rien.

Les pièces jointes des MMS (images, vidéos) vont dans `piecesJointes` (colonne de l'onglet SMS, aperçu natif
au clic). L'audio se lit dans l'aperçu grâce au patch `veridian-audio` du front (sans lui, un clic télécharge).

## L'agent du téléphone (sans serveur ni tâche planifiée)

Robert (10/11/2026) : le téléphone parle directement au CRM. `ingestion/telephone.py` tourne sous Termux sur
le Pixel, démarré par Termux:Boot et relancé par termux-services. Sa clé porte le rôle « Téléphone » de l'app
(personnes en lecture, appels et SMS en écriture, upload), pas Admin.

**Le brut d'abord, en parallèle (Robert, 12/11/2026 : « envoi brut sur le CRM puis transcript », « faut
paralléliser »).** Quatre fils, un par type (appels, SMS, MMS, messagerie vocale), chacun avec son réveil et son
empreinte : un SMS ne patiente jamais derrière un audio ni une transcription. Un cycle crée d'abord le record et ses
métadonnées en un lot ; les fichiers partent ensuite par deux files de téléversement (audio, pièces jointes), et la
transcription vient en dernier, dans son propre fil. Chaque création note son délai depuis l'événement (fin de
l'appel, envoi du SMS) dans le journal et dans `~/.local/state/crm-telephone/delais.tsv`. Mesuré le 12/11 sur une
copie vers le staging : 4 SMS et 26 appels créés 3 s après le départ, leurs audios portés dans les 5 s suivantes,
les 7 messages vocaux (audio AMR copié) en 11,6 s, pendant que les 24 MMS se relisaient à côté.

**Déclenché par l'événement.** Aucun cycle sans changement sur le téléphone, et seul le fil concerné part :

| Événement | Vu par | Délai |
|---|---|---|
| enregistrement JemRec fini | inotify | immédiat |
| appel qui commence ou finit, SMS reçu, avis de messagerie visuelle | sonde rapide : `dumpsys telephony.registry` (`mCallState`) et `dumpsys isms` (journal de l'InboundSmsHandler), natifs, toutes les 10 s | ≤ 10 s |
| SMS envoyé | dernier `_id` de `content://sms`, toutes les 15 s | ≤ 15 s |
| MMS, message vocal et son audio | dernier `_id` de `content://mms` et de `content://com.android.voicemail/voicemail`, toutes les 60 s, toutes les 15 s pendant 3 min après un appel ou un SMS reçu | ≤ 60 s |
| filet | passage complet | 30 min (2 min si adb est fermé et les sondes muettes) |

Coût mesuré le 12/11 (`time` côté adb, trois mesures) : sonde rapide 0,16 s de CPU, une sonde de fournisseur
0,37 s (une machine Java par `content`) ; soit environ 190 s de CPU par heure, 5 % d'un cœur ou 0,7 % du
téléphone, au lieu d'une relecture complète toutes les 2 minutes
(dont 98 s d'adb pour relire les 24 MMS un par un : ils sont maintenant en cache, `~/.local/state/crm-telephone/mms/lus.json`).

**Messagerie vocale.** Chaque message du fournisseur Voicemail (lu en uid 2000 par l'adb local) devient un Appel de
direction `MESSAGERIE` (`idSource` `messagerie:<ms>:<numéro>`), rattaché par numéro comme un appel. L'audio AMR
est copié une fois (`~/.local/state/crm-telephone/messagerie/`) et téléversé en Opus, car un navigateur ne lit pas
l'AMR. La transcription de Google fait foi quand le téléphone l'a ; sinon Parakeet la fait. Un message sans parole
(raccroché, -47 dB) porte « (aucune parole détectée) ».

**Transcription sur le téléphone.** Parakeet TDT 0.6B v3 q8_0 (`~/whisper.cpp/build/bin/parakeet-cli`, sortie
`-ps` : jetons horodatés au centième, remis au format `[  0.0-  2.0] texte`), par tronçons d'environ 60 s coupés
au milieu d'un silence (`silencedetect`), passés par lots de 8 au même `parakeet-cli` (modèle chargé une fois) :
l'encodeur coûte plus que proportionnellement à la durée d'un bloc (16 s pour 60 s, 271 s pour 5 min), la mémoire
reste bornée (720 Mo mesurés) et la reprise se fait au tronçon après un arrêt brutal. Appel de Hugo (32 min), le
12/11 : 13 min, en concurrence avec un banc d'essai. Whisper small
reste en secours si Parakeet échoue. Le plus récent passe d'abord. Garde batterie : toute transcription se met en
pause sous 30 % hors charge (`dumpsys battery`, reprise au tronçon), en priorité basse (`nice 15`). L'audio est
gardé et le CRM dit quel modèle a écrit chaque transcription : changer `parakeet.modele` dans les réglages fait
refaire tout ce qu'un autre modèle a transcrit, seulement en charge, et le CRM n'est remplacé que s'il porte encore
une des transcriptions que l'outil avait écrites (`_remplace`, historique `*.anciennes.json`) : une retouche à la
main reste. Réglages sans toucher au
code, `~/.config/crm-telephone/reglages.json` (clé par clé, voir `REGLAGES_DEFAUT`) :

```json
{"moteurs": ["parakeet", "whisper"], "troncon_s": 60, "lot_troncons": 8, "batterie_min_pct": 30,
 "parakeet": {"modele": "~/whisper.cpp/models/ggml-parakeet-tdt-0.6b-v3-q8_0.bin", "fils": 4}}
```

**Hors ligne.** Lecture et transcription ne demandent pas le réseau. Le CRM injoignable, l'envoi attend : une
connexion TCP au CRM toutes les 10 s (au plus tôt 30 s après l'échec) dit quand il revient, et la lecture déjà
faite part aussitôt. Un refus du CRM (HTTP) est retenté à 30 s, 1, 2, puis 5 min. Le client du téléphone
n'essaie que deux fois par requête, au lieu de bloquer une minute et demie. Éprouvé le 12/11 par une copie
d'essai (`--etat`, `--acces`, `--jemrec`) dont le CRM passait par un proxy local absent, puis présent : lecture,
transcription Parakeet et refus propre hors ligne, puis les 7 messages vocaux créés 23 s après le retour du réseau.
Termux lit le journal à la seconde : le plan rapproche donc aussi par numéro, seconde et sens (`cle_seconde`),
sans doublon avec l'historique importé par `mail`. Installation : `crm-telephonie telephone cle` (une fois), puis
`crm-telephonie telephone installer` (rejouable : code d'origin/staging, accès, services runit `crm-telephone` et
`sshd`, script Termux:Boot `~/.termux/boot/demarrer`). Journal : `$PREFIX/var/log/sv/crm-telephone/current`.

Pièges mesurés le 10/11/2026 :
- **Installer un module Termux (Termux:Boot) tue Termux** : il rejoint l'uid partagé, Android recalcule les
  permissions et arrête tout l'uid (« permissions revoked »), sshd compris. Les permissions restent accordées.
- Le Termux du Pixel est un build GitHub *debuggable* : un module doit venir de la même source (F-Droid refusé),
  et `pixel shell "run-as com.termux …"` exécute sous l'uid de Termux sans écran (réarmer sshd, `sv`).
- Termux:Boot doit être ouvert une fois à la main, sinon Android ne lui livre pas le démarrage.
- runit n'arrête que l'agent : ses enfants (whisper) sont suivis et tués avec lui sur SIGTERM.
- **Changer l'état d'un composant de Termux le tue aussi** (`cmd package disable …`, mesuré). Désactivé le 10/11 :
  `TermuxFileReceiverActivity`, qui s'offrait pour ouvrir images et PDF à la place des apps de Robert.
- Termux tué : `crm-telephonie telephone relancer` relance services, agent et sshd sans écran (`run-as` +
  `RUN_COMMAND`, qui exige `allow-external-apps = true` dans `~/.termux/termux.properties`).
- **Android 17 tue les processus enfants de Termux au-delà de 32** (« Trimming phantom processes », journal
  `am_kill`) : le 12/11 il a tué l'agent, puis runsvdir et sshd (mesuré). `telephone installer` lève la limite
  (`device_config put activity_manager max_phantom_processes 2147483647`, `settings_enable_monitor_phantom_procs
  false`, synchro de device_config gelée en `persistent`). Termux tué malgré tout : `telephone relancer`.
- `/sys/class/power_supply` est fermé à Termux : l'état de charge se lit par `dumpsys battery` (adb local).
- MMS : le fournisseur n'est ouvert qu'au shell ; l'agent passe par adb vers lui-même (127.0.0.1:5555). Port
  fermé après un redémarrage : MMS non lus jusqu'à sa réouverture, appels et SMS continuent.

L'audio vit **une fois** dans le stockage de Twenty (sauvegardé avec le CRM) ; `~/sauvegardes/appels-pixel/`
reste la source brute sur `mail`. Un clic sur l'enregistrement l'ouvre dans le navigateur, qui le lit.

## Commandes (station `mail`)

```bash
crm-telephonie app plan  --env staging --workspace cheerful-yellow-zebra   # diff du schéma, lecture seule
crm-telephonie app apply --env prod    --workspace veridian-4              # installe ou met à jour l'app
crm-telephonie ingerer   --env prod    --workspace veridian-4 --essai      # plan d'ingestion, rien n'est écrit
crm-telephonie ingerer   --env prod    --workspace veridian-4              # écrit
crm-telephonie dossier   --env prod    --workspace veridian-4              # barre latérale : People ▸ tous, étiquettes, à rattacher
crm-telephonie inconnus  --env prod    --workspace veridian-4 --top 25     # numéros sans personne, du plus fréquent
crm-telephonie telephone revoquer --env prod --workspace veridian-4        # téléphone perdu : clé révoquée (403), agent coupé
```

`--sources pixel,enregistrements,s10e` (défaut : les trois). Le Pixel est lu par le shell seul
(`pixel shell "content query …"`, `ssh pixel termux-sms-list`), jamais par l'écran. Les enregistrements
JemRec (`AAAAMMJJ_HHMMSS_in|out.ogg`, transcription `.txt` de `pixel-appels`) sont associés à l'appel du même
sens le plus proche, à 90 s près. L'ancien Galaxy S10e vient de `~/sauvegardes/telephone-s10e/2026-11-04_0104/`.

La clé API (`twenty-admin --env <env> agent:grant <workspace>`, skill `twenty-cli`) reste sur le bastion : la
commande la lit par ssh à chaque lancement, sans l'écrire ni l'afficher. `app` exige Node 24 dans le `PATH`.

Codes de sortie : 0 fait, 1 une écriture a échoué, 2 une source ou l'API n'a pas répondu.

`dossier` lit les valeurs du champ SELECT `etiquette` de Person dans le CRM (rien en dur) et crée, par
l'API de métadonnées du workspace, une vue filtrée par valeur et un dossier « People » qui range l'entrée native
de l'objet (tous les contacts) et une entrée par vue. Rejouable : seule une étiquette nouvelle ajoute quelque
chose. Un dossier Twenty s'ouvre et se ferme sans naviguer ; « People » en est la première entrée.

## Règles

- **Idempotent** : `idSource` est calculé depuis la source (date à la milliseconde, numéro, sens, empreinte du
  texte), le même quel que soit le téléphone qui a gardé l'appel. Un rejeu ne crée rien.
- **Titres** : un appel sortant sans réponse s'intitule « Sortant · sans réponse ». Un titre n'est réécrit que s'il est
  exactement celui que l'outil avait posé (ancienne règle) ; un titre retouché à la main ne bouge plus.
- **Compléter, jamais écraser** : un rejeu remplit les champs vides (personne importée depuis, enregistrement
  arrivé après) et laisse intact ce qui est posé, rattachement manuel compris.
- **Aucune personne créée** : rattachement par numéro E.164 contre les téléphones des personnes du workspace.
  Inconnu ou porté par deux personnes : pas de lien. L'import des personnes appartient à la session `crm-contacts`.
- **`app apply` en `--no-prune` par défaut** : un champ retiré du source ne supprime rien. `--prune` retire ce qui a
  quitté le source (entrées de menu retirées le 10/11/2026) ; sans `--yes`, Twenty refuse de supprimer un objet ou un champ.
- 🔴 **`twenty app uninstall` supprime les objets de l'app ET leurs données** (appels, SMS, fichiers). Ne jamais
  désinstaller ; un identifiant de `src/identifiants.ts` ne change jamais (changer l'un = supprimer l'entité).
- Les vues des onglets restent en visibilité workspace : une vue `UNLISTED` n'est pas servie au navigateur et le
  tableau resterait vide (vu le 10/11/2026). Sans le filtre « fiche courante », le tableau montre toutes les lignes.
- Version : `engines.twenty` et `twenty-sdk` suivent le serveur (2.56). Après un sync amont, rejouer
  `yarn twenty app build` puis `crm-telephonie app plan` sur le staging.

## Preuves

`python3 -m unittest discover -s ingestion/tests` (CI, job `app-telephonie`) : normalisation, parsing de
`content query`, association des enregistrements, plan idempotent ; et pour l'agent (`test_telephone.py`) :
déclenchement par les sondes, filet sans adb, hors ligne puis retour du réseau, transcription sans réseau,
jetons Parakeet en lignes horodatées, tronçons sur les silences, whisper en secours, remplacement seulement de
ce que l'outil avait posé, messagerie vocale (audio, transcription Google sur plusieurs lignes ou locale), MMS en
cache, fichier de travail hors de `/tmp`. Vu échouer : rattachement manuel écrasé, sens d'appel ignoré dans
l'association ; le 12/11, les 20 nouveaux tests sur le code d'avant (transcription multiligne tronquée, `/tmp`
codé en dur, AMR non converti, MMS relus à chaque passage, fonctions absentes).

## WhatsApp et Telegram

Prévu dans le schéma (`canal`), pas encore ingéré : Android ne journalise pas ces appels. Source possible :
la sauvegarde locale de WhatsApp (`Android/media/com.whatsapp`) ou l'export de Telegram Desktop.
