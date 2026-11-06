# SPEC clean-room — RLS (Row-Level Security) Veridian CRM

> **Auteur** : agent `ee-rls-spec` (Opus, team `crm-ee-cleanroom`, tâche #4)
> **Date** : 2026-06-14
> **Statut** : SPEC seule — **ZÉRO code écrit**. Le lead arbitre l'implémentation.
> **Cadre légal** : clean-room strict. Aucun fichier `/* @license Enterprise */`
> n'a été ouvert. Comportement spécifié depuis : doc publique Twenty, web,
> et **uniquement** le code AGPL natif (entités/types/utils sans marker EE).
> Réf : `AUDIT-LIMITE-EE-TWENTY.md`, `BACKLOG-EE-CLEAN-ROOM.md`.

---

## 0. TL;DR (pour le lead, 30 s)

**On n'a PAS besoin du RLS aujourd'hui.** Tant que le modèle de vente Veridian =
**1 workspace par client** (isolation native schema-per-workspace), le besoin
"chaque commercial voit SES leads" se couvre **sans RLS**, avec :

1. les **rôles + object-permissions natifs AGPL** (déjà 0 fichier EE), et
2. des **vues filtrées** (`Mine` : `Account Owner = me`) — natif AGPL aussi.

Le RLS EE n'apporte un vrai gain que pour **cloisonner des équipes DANS un même
workspace de façon non contournable** (le commercial ne peut PAS retirer le
filtre de la vue pour voir les leads des autres). Ce cas n'existe pas dans la
roadmap actuelle.

**Reco : RESTER en backlog.** Déclencheur d'implémentation = 1er client exigeant
des équipes cloisonnées **intra-workspace** avec garantie non-contournable
(typiquement une revente multi-équipe ou une exigence compliance). Le jour où ça
arrive : **approche B (filtrage applicatif au query-builder TwentyORM)**, ~5-8
j-agent, jamais l'approche A (Postgres RLS natif — incompatible avec l'archi
TwentyORM, détaillé §5).

---

## 1. Ce que le RLS EE fait (observable) vs ce que le natif AGPL couvre déjà

### 1.1 Le système de permissions natif AGPL — 3 niveaux, granularité OBJET

Confirmé par la doc officielle Twenty *(« Permissions cascade from general to
specific »)* et par le code AGPL natif (0 marker EE sur ces fichiers) :

| Niveau natif | Granularité | Code AGPL (vérifié) |
|---|---|---|
| **Default (All Objects)** | workspace | flags sur `RoleEntity` : `canReadAllObjectRecords`, `canUpdateAllObjectRecords`, `canSoftDeleteAllObjectRecords`, `canDestroyAllObjectRecords` |
| **Object-Level** | par objet | `ObjectPermissionEntity` : `canReadObjectRecords` / `canUpdate…` / `canSoftDelete…` / `canDestroy…` (clé `objectMetadataId` + `roleId`) |
| **Field-Level** | par champ | `FieldPermissionEntity` + `restrictedFields` (`canRead` / `canUpdate` par `fieldMetadataId`) |

**Point dur** : ces permissions sont **TOUT-ou-RIEN par objet**. Un rôle « lit
TOUS les records de l'objet Lead » ou « n'en lit AUCUN ». Il n'y a **aucune**
notion de « lit seulement les records dont je suis owner » dans le natif.

Le point d'application natif est le query-builder TwentyORM :
`packages/twenty-server/src/engine/twenty-orm/repository/permissions.utils.ts`
→ `validateQueryIsPermittedOrThrow()`. Comportement observé : il **lève une
exception** (`PermissionsException PERMISSION_DENIED`) si l'opération
(select/insert/update/delete/soft-delete) n'est pas permise sur l'objet/champ.
Il **ne filtre PAS** les lignes — c'est un garde booléen all-or-nothing, pas un
`WHERE`.

### 1.2 Ce que le RLS EE ajoute — granularité LIGNE/record

Confirmé par la doc officielle *(« Row-level permissions are a Premium feature
available on the Organization plan »)* et par le web (plan Organization
$19/user/mois) :

> *« filtrer quels records individuels un rôle peut accéder selon des critères
> dynamiques (ex : les commerciaux ne voient que leurs propres opportunités) »*

Observable depuis la **structure** (types/entités natifs qui référencent l'EE,
sans ouvrir l'EE) :

- `RoleEntity` (AGPL) porte 2 relations vers l'EE : `rowLevelPermissionPredicates`
  et `rowLevelPermissionPredicateGroups`.
- Le type partagé `ObjectPermissions` (AGPL) porte 2 champs :
  `rowLevelPermissionPredicates: RowLevelPermissionPredicate[]` et
  `rowLevelPermissionPredicateGroups`.
- Les **noms** des fichiers/types EE (lus en clair dans des imports AGPL, jamais
  ouverts) révèlent le concept observable : un **prédicat** = (champ, opérateur,
  opérande), des **groupes** combinant les prédicats par un **opérateur logique**
  (ET/OU). Le moteur d'application vit dans 4 utils EE du query-builder
  (`apply-row-level-permission-predicates`, `build-row-level-permission-record-filter`,
  `is-record-matching-rls-…`, `validate-rls-predicates-for-records`) — **non ouverts**.

**En clair** : le RLS EE transforme le garde booléen all-or-nothing en un
**filtre `WHERE` dynamique** injecté dans chaque requête, paramétré par des
prédicats stockés en base et attachés au rôle. La condition typique est
« champ-owner = utilisateur courant ».

### 1.3 La frontière, en une phrase

| | Granularité | Mécanisme | Licence |
|---|---|---|---|
| **Permissions natives** | objet + champ | **garde booléen** (throw / pass) | AGPL ✅ |
| **RLS** | **ligne / record** | **filtre `WHERE` dynamique** par prédicat | EE 🔒 |

Le natif répond à « **peux-tu** toucher cet objet/champ ? ». Le RLS répond à
« **lesquels** de ses records as-tu le droit de voir/modifier ? ».

---

## 2. Besoin réel Veridian — scénarios concrets

Hypothèse structurante (décision Robert, cf `CLAUDE.md` CRM §4 + `BACKLOG-EE`) :
**1 workspace par client**. L'isolation entre clients est donc faite par le
**schema-per-workspace** natif de TwentyORM (chaque workspace = son schéma
Postgres `workspace_<id>`), pas par du RLS. Le RLS ne concerne QUE le
cloisonnement **intra-workspace** (entre membres d'un même client).

| # | Scénario | Couvert nativement ? | Comment / Pourquoi |
|---|---|---|---|
| **S1** | Cloisonner client A vs client B | ✅ **Oui, total** | schema-per-workspace. Aucun rapport avec le RLS. |
| **S2** | « Chaque commercial voit SES leads » — confort UX | ✅ **Oui** | Vue `Mine` filtrée sur `Account Owner = me` (filtre de vue natif AGPL). Le commercial ouvre sa vue, voit ses leads. |
| **S3** | « Le manager voit toute l'équipe » | ✅ **Oui** | Rôle Manager avec `canReadAllObjectRecords` + vue non filtrée. |
| **S4** | Rôle « lecture seule sur Lead, édition sur Opportunité » | ✅ **Oui** | object-permissions par objet (natif). |
| **S5** | Masquer un champ sensible (ex : marge) à un rôle | ✅ **Oui** | field-permission `No Access` (natif). |
| **S6** | « Le commercial NE PEUT PAS voir les leads des autres, même s'il le veut » (cloisonnement **non contournable** intra-workspace) | ❌ **Non** | Une vue filtrée se **dé-filtre** en 1 clic. Le commercial a `canReadAllObjectRecords` → il peut créer une vue sans filtre, ou requêter l'API, et voir TOUT. **Seul le RLS verrouille au niveau requête.** |
| **S7** | Multi-équipes commerciales étanches dans un seul workspace (revente à un client avec N équipes qui ne doivent pas se voir) | ❌ **Non** | Même raison que S6, à l'échelle équipe. |
| **S8** | Partage conditionnel (« je vois mes leads + ceux que mon collègue m'a partagés ») | ❌ **Non** (et le RLS EE lui-même ne le fait pas proprement) | Hors scope, nécessiterait un modèle de partage dédié. |

### Verdict scénarios

- **S1→S5 (tous les besoins réels actuels)** : **couverts à 100 % en AGPL natif.**
  Aucune ligne de RLS nécessaire.
- **S6/S7** : seuls cas qui exigent vraiment le RLS. **N'existent pas dans la
  roadmap actuelle** (modèle 1 workspace = 1 client, pas de multi-équipe étanche
  intra-workspace vendu).
- **S8** : hors scope, ni natif ni RLS EE simple.

**Conclusion §2 : le RLS n'est pas un besoin produit aujourd'hui.** C'est un
besoin **conditionnel** qui n'apparaît qu'avec un modèle de vente qu'on ne
pratique pas encore (équipes cloisonnées non-contournables dans un workspace
partagé).

---

## 3. Nuance importante — « vue filtrée » ≠ « sécurité »

À graver pour éviter un faux sentiment de sécurité côté lead/Robert :

Une **vue filtrée** (S2) est du **confort d'affichage**, PAS du cloisonnement.
Un commercial avec `canReadAllObjectRecords` qui ouvre une vue « Mes leads »
voit ses leads par défaut, mais **rien ne l'empêche** de :
- créer une nouvelle vue sans filtre,
- modifier le filtre existant,
- taper directement dans l'API GraphQL/REST du CRM.

Donc :
- Si le besoin est « **par commodité**, montrer à chacun ses leads en premier »
  → **vue filtrée suffit**, c'est natif, zéro dev (S2). ✅
- Si le besoin est « **interdire** à un commercial de voir les leads des autres,
  garantie technique » → **il faut le RLS** (filtre injecté côté serveur,
  non-contournable), c'est S6/S7. 🔒

Le lead doit trancher **lequel des deux** un futur client demande. 90 % des PME
veulent le premier (confort), pas le second (cloisonnement dur).

---

## 4. Deux approches clean-room (si un jour S6/S7 se déclenche)

> Rappel : on **ne réimplémente pas** les prédicats EE. On réimplémente le
> **comportement** « un rôle ne voit que les records matchant une règle
> owner-based », clean-room, dans un module `veridian-*`. On peut viser plus
> simple que l'EE (pas besoin du builder de prédicats ET/OU complet : un simple
> « owner-scoped » couvre S6/S7).

### Approche A — Postgres RLS natif (policies SQL par schéma workspace)

**Idée** : utiliser le `ROW LEVEL SECURITY` natif de Postgres. `ALTER TABLE …
ENABLE ROW LEVEL SECURITY`, `CREATE POLICY … USING (owner_id = current_setting('app.current_user'))`,
puis `SET app.current_user = …` au début de chaque transaction.

| Critère | Évaluation |
|---|---|
| **Faisabilité dans TwentyORM** | ❌ **Mauvaise.** TwentyORM gère le schéma dynamiquement (objets/champs custom créés à la volée, migrations metadata-driven). Poser/maintenir des policies SQL sur des tables qui naissent/changent au runtime = se brancher sur le `workspace-migration-runner` → zone proche du code EE migration RLS, et fragile. La connexion DB est poolée/partagée → propager `current_user` par transaction sur un pool est piégeux (fuite de contexte entre requêtes). |
| **Risque de régression** | 🔴 **Élevé.** Une policy trop large = fuite de données ; trop stricte = l'app casse silencieusement (records invisibles partout, y compris jobs système, webhooks, agents). Les opérations système (sync, migrations, workspace member) tournent dans le même schéma. |
| **Douleur rebase upstream** | 🟡 Moyenne — la logique vit dans des migrations/hooks séparés, mais touche le workspace-migration-runner que l'upstream fait évoluer. |
| **Verdict** | ❌ **À écarter.** Le mismatch impédance avec l'archi metadata-driven de TwentyORM est rédhibitoire. Postgres RLS brille sur un schéma fixe, pas sur un schéma généré au runtime. |

### Approche B — Filtrage applicatif au query-builder TwentyORM (recommandée)

**Idée** : se brancher sur le **même point d'extension que les permissions
natives** — le query-builder workspace
(`workspace-select-query-builder.ts` et frères, AGPL) où
`validateQueryIsPermittedOrThrow()` est déjà appelé — et, au lieu de seulement
`throw`/`pass`, **injecter un `WHERE owner_field = currentUserId`** quand le rôle
porte une règle owner-scoped Veridian.

Stockage clean-room (table à nous, module `veridian-row-scope`) : une règle
minimale par (role, object) = `{ roleId, objectMetadataId, scopeFieldId, scope:
'OWN' }`. Pas de moteur de prédicats ET/OU générique au départ — on n'en a pas
besoin pour S6/S7 (« voir ses propres records » = un seul prédicat owner-based).

| Critère | Évaluation |
|---|---|
| **Faisabilité dans TwentyORM** | ✅ **Bonne.** Le point d'injection existe déjà (les query-builders AGPL reçoivent `objectsPermissions` et le contexte user). On ajoute une clause `WHERE` paramétrée — pattern standard query-builder, indépendant du schéma dynamique. |
| **Risque de régression** | 🟡 **Moyen, maîtrisable.** Le risque réel = **oublier un chemin de lecture** (agrégations, group-by, sous-requêtes, relations jointes, exports, jobs, API REST vs GraphQL) → fuite. Le code natif montre déjà les pièges : sous-requêtes bypassées (`isSubQuery`), objets système exemptés, joins traités à part. Toute approche doit couvrir **tous** ces chemins. C'est précisément pourquoi c'est SPEC-only et pas de l'autonome : il faut une matrice de tests exhaustive avant prod. |
| **Douleur rebase upstream** | 🟡 **Moyenne.** On se branche dans des fichiers AGPL que l'upstream fait évoluer (les query-builders). Stratégie pour limiter : isoler toute notre logique dans un util `veridian-*` appelé par **un seul hook** dans le query-builder, plutôt que d'éparpiller des `if` partout. 1 point de couplage = 1 conflit de rebase à résoudre, pas 15. |
| **Légal** | ✅ Clean-room OK : on observe le comportement (filtre owner-based), on ne lit pas les 4 utils EE. On vise volontairement plus simple (owner-scope) que le builder de prédicats EE. |
| **Verdict** | ✅ **Seule approche viable.** |

---

## 5. Recommandation, ordre, estimation

### Reco

1. **Maintenant : NE RIEN implémenter. RLS reste en backlog.** Pour le besoin
   actuel (S2 « chaque commercial voit ses leads » en confort), livrer une **vue
   filtrée `Mine`** dans le provisioning workspace (natif, 0 dev RLS). Documenter
   noir sur blanc que c'est du **confort, pas du cloisonnement** (§3).

2. **Déclencheur d'implémentation** (le lead/Robert le constate, pas l'agent) :
   un client signé exige des équipes **cloisonnées de façon non-contournable
   dans un même workspace** (S6/S7), OU une exigence compliance « un user ne
   doit techniquement pas pouvoir requêter les records d'un autre ».

3. **Le jour J : approche B** (filtrage applicatif query-builder), périmètre
   minimal **owner-scoped** d'abord (pas le builder ET/OU complet). Jamais
   l'approche A.

### Ordre d'implémentation (le jour où c'est déclenché)

1. Table + module `veridian-row-scope` (règle minimale role×object→scopeField). — 0,5 j
2. Hook unique dans le query-builder select AGPL : injection `WHERE` owner-scoped. — 1,5 j
3. Couvrir **tous** les chemins de lecture (update/delete/soft-delete, joins,
   agrégations/group-by, sous-requêtes, REST + GraphQL, exports). — 2 j
4. UI settings minimale (toggle « limiter ce rôle à ses propres records » +
   choix du champ owner) côté `twenty-front`. — 1 j
5. **Matrice de tests exhaustive anti-fuite** (le livrable critique) + E2E
   staging réel : un commercial owner-scoped ne voit/édite/exporte/agrège QUE
   ses records, sur tous les chemins. — 1,5-2 j

### Estimation

**5-8 j-agent** (cohérent avec le 3-5 j du `BACKLOG-EE` + la matrice de tests
anti-fuite que je chiffre à part car c'est elle qui sécurise la prod). Risque
régression **moyen** : à faire en sous-agent dédié, worktree isolé, **E2E lourd
staging obligatoire avant promo main** (un RLS qui fuit = incident données
client, tier 🔴 minimum).

### Ce qu'il NE faut PAS faire

- ❌ Réimplémenter le builder de prédicats EE complet (ET/OU/operands) « pour
  faire comme Twenty ». On vise owner-scope, point. YAGNI.
- ❌ Approche A (Postgres RLS) : incompatible archi metadata-driven.
- ❌ Vendre une vue filtrée comme une garantie de cloisonnement (§3).

---

## 6. Annexe — sources & traçabilité clean-room

**Code AGPL natif lu (0 marker EE, vérifié `head -3` avant ouverture)** :
- `engine/metadata-modules/role/role.entity.ts`
- `engine/metadata-modules/object-permission/object-permission.entity.ts`
- `engine/metadata-modules/permissions/types/user-workspace-permissions.ts`
- `engine/twenty-orm/repository/permissions.utils.ts`
- `twenty-shared/src/types/ObjectsPermissions.ts` + `ObjectPermissions.ts` (le `.ts` AGPL, pas les types `RowLevelPermissionPredicate*` qui sont EE)

**Fichiers EE identifiés et NON ouverts (interdits)** :
- `engine/metadata-modules/row-level-permission-predicate/**` (24 fichiers)
- `engine/metadata-modules/flat-row-level-permission-predicate/**`
- `engine/twenty-orm/utils/{apply-row-level-permission-predicates, build-row-level-permission-record-filter, is-record-matching-rls-row-level-permission-predicate, validate-rls-predicates-for-records}.util.ts`
- `twenty-shared/src/types/RowLevelPermissionPredicate.ts`, `RowLevelPermissionPredicateGroup.ts`
  → concept (prédicat = champ/opérateur/opérande, groupes ET/OU) déduit **des
  noms d'imports en clair**, jamais du contenu.

**Sources publiques** :
- Doc officielle Twenty — Permissions (3 niveaux Default/Object/Field ;
  « Row-level permissions are a Premium feature available on the Organization
  plan (Cloud and Self-Hosted) ») :
  https://docs.twenty.com/user-guide/permissions-access/capabilities/permissions
- Twenty Pricing — Organization plan $19/user/mois inclut le row-level :
  https://twenty.com/pricing
- `AUDIT-LIMITE-EE-TWENTY.md`, `BACKLOG-EE-CLEAN-ROOM.md` (ce repo).
