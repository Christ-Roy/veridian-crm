# UpgradeCommand échoue sur SyncStandardUiCapabilityFlags (isUIEditable sur relation fields)

> **Sévérité** : 🟢 P2 (non bloquant — app fonctionnelle, DB migrée, pas de perte data)
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
