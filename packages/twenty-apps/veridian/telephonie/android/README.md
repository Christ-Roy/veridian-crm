# App Android « Téléphonie CRM » (remplace l'agent Termux)

> Installable par n'importe qui depuis le 13/11/2026 : parcours utilisateur dans [`../LISEZMOI.md`](../LISEZMOI.md),
> détails techniques dans « Installable par un tiers » plus bas.

Le Pixel envoie lui-même au CRM (workspace `veridian-4`) chaque appel, SMS, MMS et message vocal, dans les secondes
qui suivent l'événement : le record d'abord, l'audio ensuite, la transcription en dernier. Une vraie app Android
(paquet `site.veridian.telephonie`) au lieu de `ingestion/telephone.py` sous Termux, qu'Android 17 tuait (processus
fantômes, 12/11 à 00h55 ; `LOW_MEMORY` à 04h16), et dont `termux-call-log`/`termux-sms-list` se figeaient 120 s
(cinq cycles perdus le 12/11 entre 10h40 et 13h39). Aucun cron, aucun watchdog externe.

## Le contrat, à l'identique

`contrat/` est le port Kotlin de `ingestion/crm_telephonie.py` (et des fonctions de `telephone.py` qui en dépendent) :
`idSource`, rapprochement à la seconde (`cle_seconde`), compléter sans écraser, rattachement par E.164 sans jamais
créer de personne, titres, aperçus, `sourceTranscription` et `moteurTranscription`, découpe en tronçons, silences,
lignes horodatées. Il est vérifié **contre les sorties du Python** : `outils/fixtures_contrat.py` les génère
(`contrat/src/test/resources/fixtures.json`, données fictives) et `ContratTest` exige l'égalité.

```bash
python3 outils/fixtures_contrat.py --verifier   # code 1 si le Python a changé sans que les fixtures suivent
./gradlew -p contrat test                         # JDK seul, sans SDK Android (CI)
```

Vu échouer le 12/11 (mutation, puis restauration) : règle `+330` retirée, rapprochement à la seconde retiré,
« écraser » au lieu de « compléter », arrondi Java au lieu de Python, silence final de `silencedetect` retiré ;
et un vrai écart attrapé au premier passage (horodatage des silences : ffmpeg multiplie par la base de temps).

Écart voulu, sans effet sur les doublons : la date vient du fournisseur Android **à la milliseconde**, comme
l'ingestion de `mail` (`crm-telephonie ingerer`), alors que Termux la tronquait à la seconde. Un `idSource` créé
par Termux (`appel:1794485255000:…`) et celui de l'app (`appel:1794485255200:…`) désignent le même événement :
`cle_seconde` les rapproche, l'app complète et ne recrée rien.

## Architecture

| Pièce | Rôle |
|---|---|
| `ServiceSynchro` (premier plan, `specialUse`) | déclencheurs : `ContentObserver` sur le journal d'appels, `content://sms`, `content://mms` et `content://mms-sms` (un MMS envoyé par Google Messages ne notifie que lui, mesuré le 12/11), dernier `_id` des SMS et MMS relu toutes les 60 s dans le fournisseur local ; `FileObserver` sur `/sdcard/Recordings/JemRec` ; `TelephonyCallback` (fin d'appel) ; réseau revenu |
| `Recepteur` | `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `SMS_RECEIVED`, MMS (`WAP_PUSH`), `PHONE_STATE`, chargeur branché |
| `EcouteNotifications` | une notification du téléphone (nouveau message vocal) : la messagerie est sondée tout de suite |
| `Sources` | lecture **directe et incrémentale** par le ContentResolver (lignes plus récentes que le curseur, 15 min de recouvrement), jamais tout l'historique à chaque événement |
| `Base` (SQLite) | la file persistante : un événement y entre avant tout appel réseau ; il en sort quand un plan contre le CRM ne donne plus rien à faire (empreinte gardée) |
| `Synchro` | un fil de lecture par type, un fil d'envoi des records (lots de 50), deux fils de fichiers (audio, pièces jointes) |
| `Vidange` (WorkManager, contrainte réseau) | vide la file au retour du réseau, et relance le service si le processus est mort |
| `ServiceTranscription` (processus `:transcription`) | Parakeet par JNI ; le modèle (≈ 880 Mo en mémoire) ne fait jamais tuer la synchronisation |
| `Adb` | le shell du téléphone pour l'app elle-même (messagerie vocale, voir plus bas) |

Survie : service `START_STICKY` (relancé par Android après un plantage ou un manque de mémoire), relancé au
démarrage, par WorkManager quand la file attend, et par toute commande. Aucun processus enfant : la limite des
processus fantômes d'Android 17, qui tuait Termux, ne s'applique pas.

**Hors ligne** : lecture et transcription continuent ; l'envoi échoue vite (2 essais par requête), la file attend,
WorkManager et le rappel réseau la vident au retour.

### Messagerie vocale

`com.android.voicemail.permission.READ_VOICEMAIL` est `signature|privileged|role` (mesuré sur ce Pixel le
12/11/2026, `pm list permissions -f`), `pm grant` la refuse : une app ordinaire ne peut pas lire le fournisseur.
Le shell (uid 2000) le peut. L'app parle donc le protocole adb à `adbd` du téléphone même, comme JemRec, avec **sa
propre clé RSA** (fichiers privés de l'app ; rien de Termux) :

- adb TCP sur `127.0.0.1:5555` : la clé est acceptée **une fois** à l'écran (« Toujours autoriser », empreinte
  vérifiée contre celle que l'app écrit dans son journal) ;
- après un redémarrage, 5555 est fermé : l'app rallume le débogage sans fil (`WRITE_SECURE_SETTINGS`, accordée par
  `pm grant`), trouve son port (mDNS `_adb-tls-connect._tcp`, sinon balayage local), s'y connecte en TLS avec la même
  clé, puis rouvre 5555 (`tcpip:5555`). Ce que faisait le câble USB sur `rbt`.
- mesuré le 12/11 : port fermé par `adb usb` à 16h58:37, rouvert par l'app à 16h59:17 ; après un redémarrage en
  Wi-Fi (noyau à 16h59:48), service prêt et 5555 rouvert par l'app à 17h00:29, joignable depuis `mail` à 17h00:39 ;
- un échec de connexion adb n'est jamais une exception qui remonte : le 12/11, un refus TLS non attrapé faisait planter
  l'app en boucle après le redémarrage, et Android repoussait sa relance de 3 h (corrigé, vu échouer puis réussir) ;
- **limite** : le débogage sans fil exige le Wi-Fi. Redémarré hors Wi-Fi (4G seule), le téléphone n'a pas de shell
  pour l'app : appels, SMS et MMS passent (ContentResolver), les messages vocaux attendent le Wi-Fi.

Chaque message devient un Appel de direction `MESSAGERIE` (`idSource` `messagerie:<ms>:<numéro>`), audio AMR
converti en Opus. La transcription de Google fait foi quand le téléphone l'a.

### Transcription

Parakeet TDT 0.6B v3 q8_0, whisper.cpp `d2c6f05a` (1.9.5, cible `parakeet`) compilé par le NDK r28c pour
arm64 (`armv8.2-a+dotprod+i8mm+fp16`, sans OpenMP). Tronçons de 30 s coupés au milieu d'un silence, sans
chevauchement (`bench-transcription.md` sur `mail`), un fichier et un moteur à la fois, le plus récent d'abord,
reprise au tronçon. Un appel neuf est transcrit dès qu'il arrive, sauf sous 10 % débranché (il part alors au
branchement) ; les reprises en masse (« en charge ») attendent le chargeur et 30 % (`contrat/Politique.kt`, testé).
Aucune minuterie : le processus dort jusqu'à une demande, un branchement ou un changement de batterie qui franchit
un seuil ; seule une attente de mémoire (1,5 Go vérifiés avant de charger le modèle) ou d'un autre `parakeet-cli`/
`whisper-cli` est retentée à 60 s. Les appels enregistrés restés sans transcription (option coupée, panne) depuis
72 h sont remis en file au démarrage du service, au branchement et à l'activation de l'option (`rattraper`).
Le 13/11/2026, l'option coupée sans trace avait laissé dix appels sans texte : toute bascule d'option est
journalisée avec sa source, la coupure se confirme, et l'écran ne recrée plus ses vues toutes les 3 s. Une transcription déjà
au CRM est reprise, pas refaite. `moteurTranscription` porte la recette, outil compris
(`libparakeet (whisper.cpp d2c6f05, jni)`). Whisper small, secours de l'agent Termux, n'est pas embarqué.

Mesuré le 12/11 sur ce Pixel (10,6 min d'appel) : Parakeet 129 s, soit 12 s par minute d'appel (Termux :
11 s), modèle chargé en 1,3 à 2,5 s. Il fallait SVE2 et OpenMP (sans eux : 25 s par minute) et une priorité nice 9
(à `THREAD_PRIORITY_BACKGROUND`, Android met les fils de ggml sur les petits cœurs : 34 s par minute). Le décodage
de l'Opus de JemRec par MediaCodec coûte encore environ 7 s par minute d'appel (rééchantillonnage : 0,4 s).

Audio : décodage et Opus mono 32 kbit/s par les codecs d'Android (pas de ffmpeg) ; envoi direct
`createFileUpload` → `PUT` en flux → `completeFileUpload`, jamais le multipart (plafonné à 5 Mo). Un fichier ne part
qu'une fois son record créé ; un échec est retenté sans limite, de 30 s à 30 min (le délai double, WorkManager sous
contrainte réseau). `audio_wifi_apres_echecs` (réglage, 0 par défaut) : après ce nombre d'échecs de suite sur réseau
facturé, le fichier attend le Wi-Fi ; 0 = n'importe quel réseau (Robert a un forfait illimité, 12/11/2026).

## Construire (bastion), installer, piloter

```bash
outils/construire.sh                     # bastion : whisper.cpp épinglé, tests du contrat, APK signé
outils/installer.sh APK --mode miroir --acces --modele   # mail : adb 5038, permissions, accès CRM, modèle
```

Jamais sur `mail` (poste de Robert). La clé de signature est dans `~/credentials/android/` sur le bastion, créée au
premier passage. SDK : `cmdline-tools` 12.0 vérifié contre le SHA-1 publié par Google (`repository2-3.xml`), NDK et
plateformes installés par `sdkmanager`, qui vérifie leur empreinte ; Gradle 8.13 par son SHA-256
(`gradle-wrapper.properties`).

Commandes (shell seulement, permission `DUMP`) :

```bash
C="am broadcast -a site.veridian.telephonie.COMMANDE -n site.veridian.telephonie/.Commandes --es c"
pixel shell "$C etat"                              # mode, file, adb, curseurs
pixel shell "$C mode --es valeur ecriture"          # miroir → écriture (tout est replanifié une fois)
pixel shell "$C relire --ez complet true"
pixel shell "$C retranscrire --es depuis 2026-11-10 [--ez maintenant true]"
```

Lisible sans commande : `journal.log` est écrit en direct dans `/sdcard/Android/data/site.veridian.telephonie/files/`
(`adb pull`), avec `etat.json` réécrit par le service à chaque nouvelle ligne (file, enregistreur, transcription :
en cours, en attente et pourquoi, dernière faite). `etat` y ajoute `delais.tsv` (délai entre l'événement et sa
création au CRM) et le plan miroir. Sans adb, l'écran de l'app et la notification du service montrent l'état de
l'enregistreur et de la file de transcription. Journal sans donnée personnelle, aussi dans `logcat -s TelephonieCRM`.

### Enregistrement des appels (JemRec) surveillé

JemRec enregistre par un processus du shell (`com.jemcik.jemrec.shell.Main`), lancé par adb ; après un
redémarrage, adb n'existe qu'en Wi-Fi (débogage sans fil). Sans Wi-Fi, rien ne peut le relancer sans root :
`setprop persist.adb.tcp.port` est refusé au shell (`default_prop`, mesuré le 14/11/2026). L'app ne le masque pas :
`Enregistreur` vérifie le processus (shell de l'app, sinon connexion à sa boucle locale) au démarrage du service, au
retour du Wi-Fi, au début de chaque appel ; une notification persistante « Enregistrement des appels inactif »
reste tant qu'il ne tourne pas (pas pendant les 2 premières minutes après le démarrage, sauf appel), effacée dès
qu'il revient ; 150 s après chaque appel décroché, son fichier doit exister, sinon « Appel non enregistré ». En
Wi-Fi, l'app rallume le débogage sans fil pour JemRec. Elle ne rouvre plus 5555 si l'enregistreur tourne :
`tcpip:5555` redémarre adbd, et init tue avec lui l'enregistreur de JemRec.

## Mesuré en production (12/11/2026, après la bascule de 17h01)

| Événement réel | Délai fin de l'événement → record au CRM |
|---|---|
| appel sortant (17h01:20) | 6,6 s ; audio porté 6 s après le record ; transcription Parakeet sur le téléphone 41 s après |
| SMS reçus (17h04:28, 17h29:55) | 1,3 à 2,0 s |
| MMS reçu (17h27:58) | 2,9 s (3,5 s selon `createdAt`) |
| messagerie vocale | pas encore de message neuf ; les 8 existants planifiés à l'identique de Termux |

Rejeu : deux replanifications complètes (passage en écriture), 0 création, 0 doublon à la seconde au CRM.
Arrêt forcé : `am force-stop` → service au premier plan en moins d'1 s ; `am stop-app` → 10 s. Redémarrage en Wi-Fi :
service prêt et port 5555 rouvert par l'app 41 s après le démarrage du noyau.

## Mode miroir, puis bascule

En `miroir`, l'app lit et planifie contre le vrai CRM sans rien écrire (`miroir.jsonl`).
`outils/miroir_comparer.py` (bastion) compare ce plan à ce que l'agent Termux a écrit : chaque record créé depuis
une date doit être connu de l'app, chaque création qu'elle aurait faite doit exister avec les mêmes champs.
Bascule : `mode ecriture`, puis côté Termux `SVDIR=$PREFIX/var/service sv down crm-telephone` (ses fichiers restent
pour revenir en arrière : `sv up crm-telephone` et `mode miroir`).

## Installable par un tiers (13/11/2026)

| Pièce | Rôle |
|---|---|
| `AccueilActivity` | l'écran : connexion, test, autorisations, envoi, options, état |
| `Acces` / `OAuth` | accès au CRM : clé API, ou OAuth natif de Twenty (enregistrement dynamique RFC 7591, PKCE S256, retour sur `127.0.0.1`), jetons chiffrés au Keystore, renouvelés seuls |
| `Modele` | Parakeet q8_0 téléchargé par le DownloadManager (Wi-Fi, reprise), SHA-256 vérifié |
| `Reglages.migrer` | schéma 2 : un téléphone déjà configuré reçoit en valeurs explicites ses anciens défauts |

Twenty sans patch : `/.well-known/oauth-authorization-server`, `/oauth/register` (client public, PKCE obligatoire),
`/authorize` (écran de consentement natif), `/oauth/token`. Le client enregistré dynamiquement agit avec le rôle
du membre connecté (`resolve-application-role-id.util.ts`), donc avec ses droits ; la clé API au rôle
Téléphone reste le parcours à accès limité. Une app Twenty ne peut pas créer de clé API (`createApiKey` exige une
session d'utilisateur : `api-key-role-write-access-policy.constant.ts`). Jeton d'accès 30 min, refresh 60 jours
renouvelé à chaque usage ; une révocation n'invalide pas le jeton d'accès en cours, elle prend effet à son
renouvellement (30 min au plus).

Test de connexion sans rien écrire : `PATCH /rest/<objet>/00000000-0000-4000-8000-000000000000` rend 404 si
l'écriture est permise, 403 sinon (mesuré le 13/11/2026 sur le staging, clé Téléphone contre clé Admin).

Refus du CRM (401 après un renouvellement, `invalid_grant`) : `reconnexion` posée dans les réglages, l'envoi
s'arrête sans rien perdre, notification persistante « Reconnecter à Twenty » ; la reconnexion relance tout, le
plan rapproche par `idSource` (aucun doublon).

`appareil` est un SELECT aux options fixes (`PIXEL_8_PRO`, `GALAXY_S10E`, `AUTRE`) : un tiers est enregistré
`AUTRE`, sans nouveau champ, pour ne pas réécrire les fiches existantes.

Distribution : `.github/workflows/telephonie-android.yaml` (runners Veridian) construit, signe (secrets
`TELEPHONIE_SIGNATURE_JKS_B64`, `TELEPHONIE_SIGNATURE_MDP`) et publie la release `telephonie-android` (lien
stable) et `telephonie-v<version>`, avec l'archive de l'app Twenty.

### Mesuré le 12/11/2026 (heure de Paris)

Émulateur Android 16 (API 36, x86_64, KVM sur `dev`), workspace neuf du staging `magical-mint-octopus`, app Twenty
installée depuis le registre du serveur (`twenty app publish --private` puis `app install`), APK de la CI :

| Étape | Résultat |
|---|---|
| installation, autorisations | par les dialogues de l'app, aucune configuration par adb |
| « Se connecter avec Twenty » | écran de consentement natif de Twenty, retour sur `127.0.0.1`, « Connexion prête » (lecture, objets, droit d'écrire) |
| envoi activé, tout l'historique | 1 appel et 2 SMS importés |
| SMS reçu (19h22:30) | au CRM 2,5 s après |
| appel entrant raccroché (19h22:45) | au CRM 1,3 s après |
| connexion révoquée (19h23:44) | le jeton d'accès en cours reste valide jusqu'à son expiration (30 min) |
| refresh refusé (19h51:06, `invalid_grant`) | notification persistante « Reconnecter à Twenty », 3 événements gardés en file |
| reconnexion par le navigateur (19h54:35) | file vidée, notification effacée, 0 doublon d'`idSource` |
| mise à jour depuis l'APK du Pixel configurée à l'ancienne | mode écriture, clé (même empreinte), appareil `PIXEL_8_PRO` conservés |

Pixel de Robert, mis à jour à 19h56:28 avec l'APK de la CI : réglages, clé (empreinte identique à celle du
bastion), mode écriture et appareil conservés, service prêt en 4 s. Avant (12/11) : SMS 1,3 à 1,4 s, appel 6,1 à
6,6 s, MMS 1,8 à 2,9 s ; CRM 2047 appels et 8947 SMS, 0 doublon.
