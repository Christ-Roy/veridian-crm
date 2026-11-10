# Téléphonie Veridian (app Twenty)

Les appels et les SMS de Robert dans la timeline de chaque personne du CRM.

## Ce que l'app installe

| Entité | Rôle |
|---|---|
| objet `appel` (Appels) | direction, canal (téléphone, WhatsApp, Telegram), début, durée, numéro, nom sur le téléphone, **enregistrement** (champ FILES, stockage de Twenty), **transcription**, appareil, `idSource` unique |
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
le Pixel, démarré par Termux:Boot et relancé par termux-services. Il se réveille à chaque enregistrement JemRec
fini (inotify) et au plus tard toutes les 2 minutes ; il ne contacte le CRM que si le journal d'appels, les SMS
ou les enregistrements ont changé. Il transcrit lui-même avec whisper.cpp (modèle `small`, priorité basse). Sa
clé porte le rôle « Téléphone » de l'app (personnes en lecture, appels et SMS en écriture, upload), pas Admin.
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
crm-telephonie dossier   --env prod    --workspace veridian-4              # barre latérale : People ▸ tous, une entrée par étiquette
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
`content query`, association des enregistrements, plan idempotent. Vu échouer : rattachement manuel écrasé,
sens d'appel ignoré dans l'association.

## WhatsApp et Telegram

Prévu dans le schéma (`canal`), pas encore ingéré : Android ne journalise pas ces appels. Source possible :
la sauvegarde locale de WhatsApp (`Android/media/com.whatsapp`) ou l'export de Telegram Desktop.
