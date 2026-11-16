# Google Meet (app Twenty du CRM Veridian)

Robert, 16/11/2026 : depuis une fiche **Personne, Société ou Dossier**, un bouton **« Créer un Meet »** crée
l'événement dans Google Agenda avec son lien Meet, invite les adresses de la fiche et pose une note « Meet · … »
sur les fiches. Après la réunion, l'app importe le **compte rendu** : participants, durée, lien de
l'enregistrement, transcription (enregistrement d'appel natif de Twenty + note), comme l'app Teams officielle.

## Architecture : aucun code côté serveur

Le CRM Veridian n'exécute pas de code d'app sur le serveur (`LOGIC_FUNCTION_TYPE` désactivé, choix de sécurité :
instance multi-espaces). Tout tourne donc dans le **front component**, dans le navigateur de celui qui clique :

| Pièce | Rôle |
|---|---|
| 2 fournisseurs de connexion OAuth (`google-meet` WORKSPACE, `google-meet-user` USER) | Twenty mène l'OAuth Google, garde et rafraîchit les jetons. Le compte du membre passe avant le compte partagé (même règle que `findConnectionForRequest`) |
| front component `panneau-google-meet` | formulaire (titre, date, heure, durée, invités cochés, autres adresses, envoi des invitations) ; appels directs à Google Calendar et Meet REST v2 (CORS ouvert par Google) avec le jeton lu par `appConnections` |
| objet `reunionMeet` (Réunions Meet) | un enregistrement par Meet : code de réunion, iCalUID, fiches reliées, statut du compte rendu (Planifiée, En attente, Importé, Sans transcription, Non tenue) |
| note `Meet · <titre>` | sur la fiche d'origine, sa société, et toute personne du CRM dont l'adresse est invitée ; le compte rendu s'y ajoute |
| Call Recording natif | une ligne par séance Meet, transcription au format Teams, reliée à l'événement d'agenda synchronisé par Twenty (iCalUID) |
| commande `Importer les comptes rendus Google Meet` (Ctrl+K) | importe tous les Meet passés non clos |

**Récupération des transcriptions (l'équivalent du mécanisme de Teams)** : Teams s'abonne aux notifications de
Microsoft Graph, ce qui exige du code serveur. Ici, l'import part **à l'ouverture du panneau Meet d'une fiche**
(les Meet passés non clos de la fiche) et sur la commande globale. Aucune tâche planifiée. Idempotent : chaque
note, lien de note, réunion et enregistrement a un identifiant dérivé d'une graine (`uuidDepuisGraine`) et
s'écrit en `upsert` ; rejouer un import réécrit les mêmes lignes.

**Échec d'authentification** : un 401 ou `invalid_grant` de Google appelle `reportAppConnectionAuthFailure` ;
Twenty marque la connexion, le panneau affiche « Reconnecter » et n'utilise plus cette connexion.

## Google Cloud

Projet `veridian-crm-8013`, client OAuth « Veridian CRM Web » (celui de la synchro mail et agenda du CRM),
redirection ajoutée le 16/11 : `https://crm.app.veridian.site/auth/apps/callback`. API activées : Calendar,
Meet (`gcloud services enable meet.googleapis.com`). Scopes : `openid`, `email`, `calendar.events`,
`meetings.space.readonly`. Variables serveur `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` posées sur
l'enregistrement de l'app par l'API metadata (`updateApplicationRegistrationVariable`), lues dans l'env de
`crm-server` (`AUTH_GOOGLE_CLIENT_*`) : jamais dans ce dépôt.

🔴 Le client OAuth est partagé avec la synchro du CRM : **pas de `revokeEndpoint`** (révoquer chez Google révoque
tout l'accord du compte à ce client, la synchro tomberait) ni d'`include_granted_scopes`.

🟠 L'écran de consentement est en **Test** : un compte doit être dans « Utilisateurs tests » et son jeton de
rafraîchissement expire au bout de 7 jours (« Reconnecter » une fois par semaine). Le passer en Production
(page Branding à compléter) lève la limite.

## Limites connues

- Transcriptions et enregistrements Meet : **Google Workspace** seulement (pas un compte gmail.com).
- La connexion USER se fait dans Réglages > Utilisateur > Préférences des apps, page derrière le drapeau
  `IS_APP_PREFERENCES_ENABLED` ; sans lui, on connecte le compte partagé (Réglages > Applications > Google Meet).

## Déployer, tester

```bash
./deployer.sh test                    # 21 tests (node --test + tsx) puis typage strict
./deployer.sh plan prod veridian-4    # tests, typage, puis plan
./deployer.sh apply prod veridian-4   # tests, typage, puis apply
```

Les tests (`tests/meet.test.ts`) ont été vus échouer : 14 mutations injectées dans `src/utils/` (16/11), toutes
détectées.

## Pièges mesurés le 16/11/2026

- Le bac à sable des front components n'a pas `crypto.randomUUID` (« FrontComponent error » au premier essai) :
  SHA-256 écrit en clair dans `identifiant-stable.util.ts`, vérifié contre `node:crypto`.
- Une note créée avec `bodyV2.markdown` seul garde `blocknote` à null : l'app écrit les deux
  (`blocknote.util.ts`), rendu vérifié dans la note.
