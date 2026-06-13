# Twenty — connexion IMAP/SMTP/CalDAV pilotable par API (config tunnel sans friction)

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-crm (OPUS)
> **Créé** : 2026-06-11
> **Résolu** : 2026-06-13 (testé en PROD réelle sur le compte Lark de Robert)

## Réponse — 2026-06-13 (agent imap-api)

**Livré et prouvé en prod.** La feature est 100 % pilotable par API via les
mutations natives AGPL, sans aucune modif de code Twenty.

### (a) DTO input exact

Mutation sur endpoint **`/metadata`** (AGPL, aucun header `@license Enterprise`) :

```graphql
saveImapSmtpCaldavAccount(
  handle: String!,
  connectionParameters: EmailAccountConnectionParameters!,
  id: UUID            # optionnel → update idempotent d'un compte existant
) { success connectedAccountId }
```

`EmailAccountConnectionParameters = { IMAP?, SMTP?, CALDAV? }`, chaque protocole :

```
{ host: String!, port: Int!, username: String, password: String, secure: Boolean }
```

Validation zod serveur : `host` requis, `port` int positif, `password` requis à
la création (optionnel en update : réutilise l'ancien si omis). `username`/`secure`
optionnels (`username` fallback = `handle`, `secure` défaut = true).

### (b) Token qui marche → **access token USER** (PAS l'API key admin)

Le resolver porte le décorateur `@AuthUserWorkspaceId()` qui rejette explicitement
les API keys : `"This endpoint requires a user context. API keys are not supported."`
Le `SettingsPermissionGuard(CONNECTED_ACCOUNTS)` accepterait pourtant une API key,
mais le décorateur la bloque avant. → On génère un access token user via
`getLoginTokenFromCredentials` → `getAuthTokensFromLoginToken` (user de rôle Admin).
**Conception native, pas un hack.**

### (c) Preuve test réel (PROD, tenant Veridian `a8fe3bdf…`, compte Lark Robert)

1. `saveImapSmtpCaldavAccount` IMAP+SMTP+CalDAV (un seul appel) → `success:true`,
   `connectedAccountId = ea4de532-714b-4715-bc8c-303d75cf4dc2`. Le serveur a testé
   la connexion **live** (`IS_IMAP_SMTP_CALDAV_CONNECTION_TEST_ENABLED=true`) → OK.
2. `core.connectedAccount` : provider `imap_smtp_caldav`, IMAP+SMTP+CALDAV présents,
   `authFailedAt=NULL`. 8 dossiers IMAP réels découverts (INBOX, Envoyés, Sent…).
3. `startChannelSync(connectedAccountId)` → `success:true`.
4. Worker : `Connected to IMAP server for robert.brunon@veridian.site`,
   `toImportCount: 736`. Import en cours → **221 messages réels** stockés +
   221 `messageChannelMessageAssociation` (vérif API data `messages`,
   participants FROM/TO réels) → remontent dans la timeline des prospects matchés.
   CalDAV en fetch.

### ⚠️ 2 mutations + 4 pièges (le cœur du ticket)

- **2 mutations obligatoires** : `saveImapSmtpCaldavAccount` **puis**
  `startChannelSync(connectedAccountId)`. Sans la 2e, les channels restent en
  `PENDING_CONFIGURATION` et **aucun cron ne les ramasse** (le
  `skipMessageChannelConfiguration` n'existe que pour OAuth Google/MS).
- Les **3 protocoles dans UN SEUL appel** : `connectionParameters` est REMPLACÉ
  (pas mergé) à chaque save.
- **CalDAV** : URL avec schéma `https://` + port 443 ; username = identifiant
  technique Lark (`u_xxxx`), pas l'email.
- Token user, jamais API key (cf (b)).

### (d) Helper rejouable + doc

- **Helper** : `~/.claude/skills/admin-twenty/iac/scripts/connect-imap-smtp-caldav.py`
  (Python, enchaîne token user → save 3 protocoles → startChannelSync ; idempotent
  via `--account-id` ; `--no-sync` possible ; creds passés en args, jamais en dur).
- **Doc skill** : SKILL.md section "📬 Connecter une boîte IMAP/SMTP/CalDAV par API"
  (DTO, 4 pièges, vérif, +entrée d'index).

### (e) Reste ouvert

- Rien de bloquant. La brique "comptes mail/cal par API" du provisioning d'un
  tenant est fermée.
- Note infra : `core.dataSource` est vide en prod (le mapping workspaceId→schema
  passe par un autre chemin) ; le schéma data du tenant Veridian est
  `workspace_a067z52qozda1h1kofzyyrfla`. Sans impact sur la feature.
- Idée future (hors scope) : exposer le flow dans `twenty-iac` pour provisionner
  les comptes mail d'un client en une passe IaC (le helper est déjà rejouable).
