# UpgradeCommand échoue sur SyncStandardUiCapabilityFlags (isUIEditable sur relation fields)

> **Sévérité** : 🟡 P1 (le sync 2026-06-15 transforme cette dette en régression
>   RUNTIME bloquante — voir maj 2026-06-15. Sur la PROD actuelle elle reste 🟢
>   non bloquante, mais elle GATE la promo du sync upstream e70776f705.)
> **Owner** : agent veridian-crm
> **Créé** : 2026-06-14

## Contexte

Lors de la promo en prod du merge upstream Twenty (sync 2026-06-13, range
`6ce070e134` Merge upstream + 2.9.0→2.13.0, image `:latest` digest
`sha256:6b82dc1e…085616`, déployée le 2026-06-14), la commande d'upgrade Twenty
a échoué sur le step `SyncStandardUiCapabilityFlagsCommand` :

```
[SyncStandardUiCapabilityFlagsCommand] Found 25 standard object(s) and 402
  standard field(s) with drifted UI capability flags for workspace <id>
[WorkspaceMigrationValidateBuildAndRunService] buildWorkspaceMigration … status=fail
[SyncStandardUiCapabilityFlagsCommand] Failed to sync standard UI capability flags:
  {
    "status": "fail",
    "report": { "fieldMetadata": [ {
      "status": "fail",
      "errors": [ {
        "code": "FIELD_MUTATION_NOT_ALLOWED",
        "message": "Forbidden updated properties for relation field metadata: isUIEditable",
      } ],
      "flatEntityMinimalInformation": { "name": "timelineActivities", … }
    } ] }
  }
[UpgradeCommand] Upgrade failed: Upgrade completed with 4 workspace failure(s)
```

- **PROD** : 4/4 workspaces actifs en échec (183e4654, 2f529b8f, a8fe3bdf, f7e83cd3).
- **STAGING** (même image upstream, validé "sain 13h+") : 1/6 workspace en échec,
  même cause. → comportement connu, hérité du staging, **pas une régression prod**.

## Cause racine (bug upstream Twenty)

Les commits du merge upstream introduisent les flags `isUIEditable` (rename de
`isUIReadOnly`, commit `1efa3567`) et `isUICreatable` (commit `036d9a2b`).
Au boot, `SyncStandardUiCapabilityFlagsCommand` veut réconcilier ces flags sur
les objets/champs standard "drifted". Pour les **relation fields** (ex.
`timelineActivities`), il tente de muter `isUIEditable`, **ce que le validateur
de migration de Twenty lui-même interdit** (`FIELD_MUTATION_NOT_ALLOWED —
Forbidden updated properties for relation field metadata`). Contradiction interne
upstream : la commande de sync génère une mutation que le validateur rejette.
Rien à voir avec notre fork Veridian ni avec notre schéma DB.

## Impact réel (évalué)

- ✅ Migration de **schéma** DB réussie ("Successfully migrated DB!"), colonnes
  présentes, aucune erreur `column/relation does not exist` résiduelle.
- ✅ App fonctionnelle post-deploy : Nest started, healthz `{"status":"ok"}`,
  `/graphql` et `/metadata` répondent, front HTML servi (HTTP 200).
- ⚠️ Les **flags UI** (`isUIEditable`/`isUICreatable`) sur certains champs
  STANDARD restent potentiellement non synchronisés → l'éditabilité/création UI
  de quelques champs standard peut être incohérente avec ce qu'upstream attend.
- ✅ AUCUNE perte de données, AUCUN workspace cassé, AUCUN crashloop.

## Pistes de résolution (clean, AGPL — PAS toucher EE)

1. **Attendre un fix upstream** : vérifier les issues/PR twentyhq/twenty sur
   `SyncStandardUiCapabilityFlags` + relation field metadata. Si fix mergé en
   amont, le prochain sync upstream le ramène. C'est l'option la plus propre.
2. **Patch clean-room AGPL** : si le step doit passer, corriger la commande de
   sync pour SKIP les relation fields (ne pas tenter `isUIEditable` dessus) —
   fichier AGPL, à confirmer non-`@license Enterprise` avant tout Edit. Couvrir
   par un `*.veridian.spec` (patch-survival).
3. **Re-run ciblé** : relancer la commande d'upgrade en mode `--workspace-id` une
   fois le fix dispo, sans redéployer toute la prod.

## Vérification de l'état actuel

```bash
ssh prod-pub 'docker logs compose-parse-optical-array-lvh5md-crm-server-1 2>&1 \
  | grep -iE "SyncStandardUiCapability|FIELD_MUTATION_NOT_ALLOWED|Upgrade completed"'
```

Backup pré-deploy disponible (filet) :
`prod-pub:/home/ubuntu/backups/crm-prod/crm-prod-twenty-20260614-060749.dump`
(custom -Fc, restaurable vérifié, sha256 eb93f24001…c48a7).

## Décision (2026-06-14) — promo prod actée RÉUSSIE, pas de rollback

Tranché par le team lead après vérification croisée : **deploy considéré réussi,
dette ci-dessus tracée pour traitement ultérieur.** Justification :

- Échec **identique au staging** validé "sain 13h+" (même
  `SyncStandardUiCapabilityFlagsCommand`, upgrade 2.9.0→2.13.0) → pas une
  régression introduite par la prod.
- **Impact data nul** : migration de schéma DB réussie, app pleinement
  fonctionnelle (front HTTP 200, `/graphql` + `/metadata` OK, healthz `ok`),
  server+worker `rc=0` stables.
- Un rollback réintroduirait l'ancienne version (perte des 47 CVE corrigées +
  du merge upstream) **sans rien régler** au souci cosmétique.

Filets en place si besoin futur :
- Image `:rollback` sur GHCR = l'ancienne `:latest` (digest applicatif
  `sha256:2f096490…c1c64d`, retaggée au build main avant écrasement).
- Backup DB pré-deploy ci-dessus.

Nouvelle image prod : `:latest` digest `sha256:6b82dc1e…085616`, ImageID
`e042cdd6…`, déployée via compose.deploy (composeId `8zdqAAD1lkZFVAwuZ5USv`)
après `docker pull` forcé (contournement du piège autoDeploy Dokploy).

## ⚠️ MAJ 2026-06-15 — le sync upstream `e70776f705` AGGRAVE cette dette (régression runtime)

Le sync upstream du 2026-06-15 (29 commits, marker `76f69efb43` → `e70776f705`,
commit fork `629d99a57a`, image staging digest `dc2acef1…`) embarque les fixes
upstream censés résoudre cette dette : **#21543** ("write 2.13 UI capability
flags directly, bypassing validation") + **#21504/#21537** (rename fallout).
Testé on-premise sur staging — résultat : **NON résolu, et le symptôme empire.**

### Ce qui a changé
- **Avant (image du 2026-06-14)** : `SyncStandardUiCapabilityFlags` échoue avec
  `FIELD_MUTATION_NOT_ALLOWED — relation field metadata: isUIEditable`.
  **Non bloquant** : l'app sert, GraphQL/REST OK.
- **Après (sync #21543)** : la commande échoue toujours (5/5 workspaces staging,
  0 completed), mais désormais sur `column ObjectMetadataEntity.isUIReadOnly does
  not exist`. **ET — bloquant — les requêtes data GraphQL ET REST CASSENT** sur
  TOUS les workspaces avec la même erreur (`GET /rest/companies` → 400,
  `query{people}` → QueryFailedError). Vérifié avec un vrai Bearer (JWT API-key
  forgé via `APP_SECRET`).

### Cause racine (bug cross-version upstream, pas notre fait)
Le fix #21543 lit le drift via le **cache flat-metadata** (ORM
`ObjectMetadataEntity`), qui mappe encore `isUIReadOnly` via `@WasRemovedInUpgrade`.
L'`UpgradeAwareEntityMetadataAdapter` ne masque cette colonne que si le **cursor
de version du workspace** est assez avancé. Or les workspaces sont **bloqués sur
`SyncStandardUiCapabilityFlags`** (cursor figé) → l'adapter ne masque pas →
le SELECT inclut `isUIReadOnly` → crash (la colonne core est déjà renommée en
`isUIEditable` par la migration instance `RenameIsUiReadOnly…`, completed). C'est
un **deadlock cross-version**. Upstream documente n'avoir PAS testé ce cas en
runtime (cf message #21543 : "I could not run a live cross-version repro").

### Comparaison PROD (décisive)
La PROD tourne l'**ancien** code (SHA `3ccfb46c`, sans #21543) → ses requêtes data
**marchent** (READ companies → vraies données) malgré le même état d'upgrade
(4 workspaces failed sur `SyncStandardUiCapabilityFlags`, colonne core déjà
renommée). ⇒ **Promouvoir le sync casserait la prod** (au reboot, recompute du
cache flat-metadata avec le nouveau code → même crash). Sync NON promu, prod
intacte.

### État de la promo
- Staging déployé sur le sync (`629d99a57a`), **NON promu en main/prod** (tier 🔴
  + régression bloquante).
- Backup DB staging pré-sync : `dev-pub:~/backups/crm-staging/crm-staging-presync-20260615-004502.dump`.

### Pistes (clean AGPL — fichier `2-13-…-sync-standard-ui-capability-flags.command.ts` vérifié non-EE)
1. **Patch clean-room** : lire le drift en **SQL brut** sur `core.fieldMetadata`/
   `core.objectMetadata` (comme le fait déjà la phase d'écriture du #21543) au
   lieu de passer par le cache flat-metadata ORM → évite le SELECT `isUIReadOnly`.
   Couvrir par un `*.veridian.spec`. **Reco privilégiée.**
2. Faire avancer le cursor des workspaces hors de cette commande (ordering).
3. Attendre un fix upstream (cross-version non testé en amont) — coûte la dette CVE.
