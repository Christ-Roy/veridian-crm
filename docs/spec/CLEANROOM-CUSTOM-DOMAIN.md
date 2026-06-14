# Clean-room — Custom domains (white-label) AGPL Veridian

> **Module** : `packages/twenty-server/src/modules/veridian-custom-domain/`
> **Licence** : AGPLv3, `Copyright (c) 2026-present Veridian`
> **Auteur** : agent `ee-domains` (team `crm-ee-cleanroom`)
> **Date** : 2026-06-14
> **Référence légale** : `docs/spec/AUDIT-LIMITE-EE-TWENTY.md`

---

## 0. Contrainte légale (clean-room)

Le custom domain Twenty est partagé entre du code **AGPL** (qu'on peut lire et
réutiliser) et du code **EE** (qu'on ne lit JAMAIS). La frontière exacte sur ce
périmètre :

**Fichiers EE — JAMAIS ouverts** (vérifiés `head -5`, marker `/* @license Enterprise */`) :
- `engine/core-modules/cloudflare/controllers/dns-cloudflare.controller.ts`
- `engine/core-modules/cloudflare/guards/cloudflare-secret.guard.ts`
- `engine/core-modules/dns-manager/services/dns-manager.service.ts` ← **le cœur EE** (logique Cloudflare for SaaS / custom hostnames)

**Fichiers AGPL lus** (point d'accroche, comportement observable) :
- `engine/core-modules/domain/custom-domain-manager/services/custom-domain-manager.service.ts`
- `engine/core-modules/public-domain/public-domain.service.ts` + `.resolver.ts` + `.entity.ts` + cron
- `engine/core-modules/domain/workspace-domains/services/workspace-domains.service.ts` (routing hostname→workspace)
- `engine/core-modules/dns-manager/dtos/domain-valid-records.ts` (DTO `DomainValidRecords`, AGPL)
- `engine/core-modules/dns-manager/validator/dns-manager.validate.ts` (AGPL)
- `engine/core-modules/workspace/workspace.entity.ts` (champs `subdomain`, `customDomain`, `isCustomDomainEnabled`)

La logique EE qu'on réécrit **de zéro** est la couche `DnsManagerService`. Son
contrat (signatures + comportement attendu) est déduit **uniquement** des
callsites AGPL ci-dessus, jamais du fichier EE.

---

## 1. Comportement observable (ce que voit l'admin/le client)

### Côté client (utilisateur final du CRM)

Un workspace est accessible par défaut sur `<subdomain>.crm.veridian.site`.
Le white-label = le même CRM accessible sur `crm.client.com` (le domaine du
client), avec le certificat SSL du client servi par notre proxy.

Parcours observable :
1. L'admin du workspace déclare un custom domain (`crm.client.com`).
2. Le système renvoie une liste de **records DNS à poser** chez le client :
   - un CNAME `crm.client.com → <cible Veridian>` (routage HTTP)
   - éventuellement un enregistrement de **validation SSL** (TXT/CNAME de
     challenge ACME, type `validationType: 'ssl'`)
3. Tant que les records ne sont pas posés/propagés : `isCustomDomainEnabled = false`,
   le CRM reste accessible uniquement par le subdomain.
4. Une fois les records détectés valides (CNAME résolu + SSL émis) :
   `isCustomDomainEnabled = true`, le CRM répond sur `crm.client.com`.
5. Le système re-vérifie périodiquement (cron horaire) les domaines non validés
   et flippe le flag dès que ça marche. Émission d'un event log à
   l'activation/désactivation.

### Structure des records (DTO AGPL `DomainValidRecords`, réutilisé tel quel)

```ts
{
  id: string;            // uuid du workspace porteur
  domain: string;        // "crm.client.com"
  records: Array<{
    validationType: 'ssl' | 'redirection';
    type: 'cname';
    status: string;      // "pending" | "active" | "error"
    key: string;         // nom du record à créer (host)
    value: string;       // valeur cible du record
  }>;
}
```

### Règles métier (lues côté AGPL)

- **Unicité globale** : un custom domain ne peut appartenir qu'à un seul
  workspace, et ne peut pas collisionner avec un `publicDomain` déjà enregistré.
- **Idempotence** : re-set du même domaine = no-op.
- **Rollback** : si l'insert DB échoue après provisioning DNS → on dé-provisionne
  (compensation), pour ne pas laisser un hostname orphelin.
- **Routing** : `resolveWorkspaceAndPublicDomain(origin)` (AGPL) résout déjà
  `where: { customDomain: domain }`. **Rien à recâbler côté routing** : dès que
  `workspace.customDomain` est set + `isCustomDomainEnabled = true`, le routing
  AGPL existant trouve le workspace. Notre seul travail = provisionner le proxy
  (Traefik/Cloudflare) pour que la requête HTTPS arrive jusqu'au serveur.

---

## 2. Différence d'archi : Twenty (Cloudflare for SaaS) vs Veridian (notre infra)

| | Twenty EE | Veridian clean-room |
|---|---|---|
| Provisioning hostname | Cloudflare **for SaaS** (custom hostnames API, SSL on-demand par hostname) | Cloudflare **DNS** (zone `veridian.site`) + Traefik dynamique sur notre cible |
| Cible CNAME du client | hostname Cloudflare SaaS | `crm.veridian.site` (notre edge Traefik) |
| Émission SSL | Cloudflare SaaS gère le cert par hostname | Traefik ACME (Let's Encrypt, TLS-ALPN ou DNS-01 via notre token CF) |
| Validation | API Cloudflare custom_hostnames status | (a) résolution DNS du CNAME + (b) handshake HTTPS réel sur le domaine |
| Creds | `CLOUDFLARE_API_KEY` (EE) | `CF_API_TOKEN` / `CF_ZONE_ID` / `CF_ACCOUNT_ID` (NOS creds, `~/credentials/.all-creds.env`) |

**L'avantage Veridian** (et la raison pour laquelle la clean-room est simple) :
le client n'a qu'à faire pointer **un CNAME** `crm.client.com → crm.veridian.site`.
Notre edge Traefik écoute déjà en wildcard `Host` + ACME. Pas besoin de l'API
custom-hostnames Cloudflare SaaS : Traefik émet le cert à la volée au premier
handshake TLS (TLS-ALPN-01) tant que le CNAME résout vers notre IP.

Donc le provisioning DNS côté Veridian est **quasi-passif** : on n'a pas à créer
de record dans la zone du client (c'est lui qui le fait), on a juste à :
1. enregistrer le mapping workspace→domaine en DB,
2. dire au client quel CNAME poser,
3. vérifier que ça résout + que le HTTPS répond,
4. (option) si on gère AUSSI le DNS du client via délégation, créer le CNAME
   nous-mêmes via l'API Cloudflare avec nos creds.

---

## 3. Architecture du module clean-room

```
modules/veridian-custom-domain/
├── veridian-custom-domain.module.ts        # NestJS module
├── services/
│   ├── veridian-dns-resolver.service.ts     # vérif DNS pure (CNAME) + HTTPS reachability — ZÉRO dépendance EE
│   └── veridian-custom-domain.service.ts    # orchestration: set / check / records / mapping DB
├── dtos/
│   ├── veridian-domain-records.dto.ts       # records DNS à poser (forme alignée sur DomainValidRecords AGPL)
│   └── set-custom-domain.input.ts           # input GraphQL admin
├── resolvers/
│   └── veridian-custom-domain.resolver.ts   # mutations admin: setVeridianCustomDomain / checkVeridianCustomDomain / removeVeridianCustomDomain
├── constants/
│   └── veridian-custom-domain.constants.ts  # cible CNAME (crm.veridian.site), TTL, etc.
└── __tests__/
    ├── veridian-dns-resolver.service.veridian.spec.ts
    └── veridian-custom-domain.service.veridian.spec.ts
```

### 3.1 `VeridianDnsResolverService` (le remplaçant clean-room de DnsManagerService)

Réécriture **from scratch** de la couche que Twenty délègue à Cloudflare for SaaS.
Méthodes (contrat déduit des callsites AGPL) :

- `buildExpectedRecords(domain): VeridianDomainRecords`
  → calcule les records que le client doit poser. Pour notre infra : un seul
    CNAME `domain → crm.veridian.site`. Pur, sans I/O.
- `resolveCname(domain): Promise<string[]>`
  → `dns.promises.resolveCname` natif Node. Renvoie les cibles CNAME.
- `isPointingToVeridian(domain): Promise<boolean>`
  → le CNAME (ou la chaîne CNAME→A) résout-il vers notre edge ?
- `isHttpsReachable(domain): Promise<boolean>`
  → handshake HTTPS réel sur `https://domain/healthz` (timeout court), confirme
    que Traefik répond + cert servi. C'est la preuve "le domaine marche".
- `isHostnameWorking(domain): Promise<boolean>`
  → `isPointingToVeridian && isHttpsReachable`. (équivalent observable du
    `isHostnameWorking` EE)
- (option, si on gère le DNS du client) `ensureCnameViaCloudflare(...)`
  → POST `client/v4/zones/{zone}/dns_records` avec `CF_API_TOKEN`. **Désactivé
    par défaut** (le client gère son DNS) ; activable par flag d'env.

**ZÉRO import du module EE.** Dépend uniquement de : `dns` (Node natif),
`undici`/`fetch` (HTTPS), `TwentyConfigService` (lire la cible CNAME + creds CF).

### 3.2 `VeridianCustomDomainService` (orchestration)

Réécriture **du comportement observable** de `CustomDomainManagerService` AGPL,
sans la dépendance `DnsManagerService` EE — on injecte notre resolver à la place.

- `setCustomDomain(workspace, domain)` :
  - normalise (`trim().toLowerCase()`)
  - vérifie unicité (workspace.customDomain + publicDomain) — même règle AGPL
  - écrit `workspace.customDomain = domain`, `isCustomDomainEnabled = false`
  - (pas d'appel EE — on ne "registerHostname" pas chez Cloudflare SaaS ;
    le provisioning = Traefik passif + CNAME client)
- `getExpectedRecords(workspace): VeridianDomainRecords`
  - délègue à `resolver.buildExpectedRecords`
- `checkCustomDomain(workspace)` :
  - `working = resolver.isHostnameWorking(workspace.customDomain)`
  - si `working !== workspace.isCustomDomainEnabled` → save + (option) event log
  - renvoie les records + statut
- `removeCustomDomain(workspace)` :
  - `workspace.customDomain = null`, `isCustomDomainEnabled = false`, save
  - (option) supprime le CNAME via CF si on l'avait créé

> **Note d'accroche AGPL** : on **ne touche pas** au `CustomDomainManagerService`
> AGPL existant ni au routing `workspace-domains.service.ts`. Notre service écrit
> les mêmes colonnes (`customDomain`, `isCustomDomainEnabled`) sur la même entité
> `WorkspaceEntity`, donc le routing AGPL natif résout le workspace sans
> modification. On vit **en parallèle** du chemin Twenty natif (qui reste gated
> EE et donc inactif sans clé EE), pas en surcharge.

### 3.3 Resolver GraphQL admin

Mutations exposées (gardées par `WorkspaceAuthGuard` + permission settings, comme
le resolver AGPL public-domain) :
- `setVeridianCustomDomain(domain: String!): VeridianCustomDomainResult!`
- `checkVeridianCustomDomain: VeridianCustomDomainResult!`
- `removeVeridianCustomDomain: Boolean!`

`VeridianCustomDomainResult = { domain, isEnabled, records: [VeridianDomainRecord] }`.

### 3.4 Persistance

**Pas de nouvelle table nécessaire pour le MVP** : les colonnes `customDomain` +
`isCustomDomainEnabled` existent déjà sur `core.workspace` (AGPL). On les
réutilise. Donc **zéro migration destructive, zéro DROP** — on lit/écrit des
colonnes existantes. (Tier risque réel = 🟡 nouvelle route/resolver, PAS 💀.)

> Si plus tard on veut tracer l'historique de validation (timestamps, erreurs),
> on ajoutera une table `veridian_custom_domain_check` — hors MVP, noté en dette.

---

## 4. Intégration infra (Traefik / Cloudflare)

- **Cible CNAME** : `crm.veridian.site` (l'edge Traefik prod). Constante du module,
  surchargeable par env `VERIDIAN_CUSTOM_DOMAIN_TARGET`.
- **Traefik** : le routeur prod doit accepter `Host(\`crm.client.com\`)`. Deux
  options selon le setup : (a) une règle `HostRegexp` / catch-all qui route tout
  host inconnu vers le serveur Twenty (le routing applicatif AGPL résout ensuite
  le workspace par `customDomain`) ; (b) ajout dynamique d'un routeur par domaine.
  → **MVP = option (a)** : un seul routeur Traefik `HostRegexp(\`.+\`)` priorité
  basse + ACME `tlschallenge`, le serveur résout le workspace. Documenté dans
  `06-deploiement-infra.md` (ticket infra déposé si besoin de patch compose prod).
- **SSL** : Traefik ACME TLS-ALPN-01 émet le cert au premier handshake (tant que
  le CNAME résout vers notre IP). Pas de DNS-01 nécessaire pour les domaines
  clients (ils ne sont pas dans notre zone).
- **Creds CF** (`CF_API_TOKEN`, `CF_ZONE_ID`, `CF_ACCOUNT_ID`) : utilisés
  uniquement si on active `ensureCnameViaCloudflare` (cas où Veridian gère le DNS
  du client). Sinon non sollicités.

---

## 5. Tests (`*.veridian.spec.ts` — auto-sélectionnés par la CI)

La CI tourne `--testPathPattern="(sign-in-up|create-company\.service|\.veridian\.spec)"`.
Tout fichier `*.veridian.spec.ts` est donc exécuté automatiquement.

1. `veridian-dns-resolver.service.veridian.spec.ts` :
   - `buildExpectedRecords` renvoie le bon CNAME (cible = constante)
   - `isPointingToVeridian` true si CNAME résout vers la cible, false sinon
     (mock `dns.promises.resolveCname`)
   - `isHttpsReachable` true/false selon réponse fetch (mock)
   - `isHostnameWorking` = AND des deux
   - aucun appel réseau réel en test
2. `veridian-custom-domain.service.veridian.spec.ts` :
   - `setCustomDomain` rejette un domaine déjà pris par un autre workspace
   - rejette un domaine déjà publicDomain
   - no-op si même domaine
   - `checkCustomDomain` flippe `isCustomDomainEnabled` quand le resolver dit OK
   - `removeCustomDomain` remet les colonnes à null/false

---

## 6. Périmètre & livraison

- ✅ Aucun fichier EE lu/ouvert/modifié (pre-push EE-gate + CI gate garants).
- ✅ Réutilise le routing AGPL natif (`resolveWorkspaceAndPublicDomain`) — pas de
  surcharge, on écrit les colonnes existantes.
- ✅ Module 100% AGPL, copyright Veridian.
- ✅ Tests `.veridian.spec` auto-sélectionnés.
- ⏳ Patch infra Traefik prod (HostRegexp catch-all + ACME) : ticket infra à
  déposer dans `veridian-infra/todo/` (hors périmètre code de ce repo).
- ⏳ Doc skill `admin-twenty` : section "déclarer un custom domain client".
