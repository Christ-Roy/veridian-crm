# Désactiver les workflows upstream Twenty réintroduits par le merge (bruit CI sur push main)

> **Sévérité** : 🟢 P2 (bruit CI, pas bloquant — la prod ne dépend que de l'image GHCR)
> **Owner** : agent veridian-crm
> **Créé** : 2026-06-14

## Constat
Le merge upstream 2026-06-13 (76f69efb43) a réintroduit des workflows GitHub
Actions upstream taillés pour le monorepo Twenty, qui s'arment sur push:main et
vont rougir à chaque promo (CI Front run 27490275818, CI Create App 27490275782,
+ probablement d'autres ci-*.yaml). Ils sont HORS périmètre Veridian : la prod
ne dépend que de l'image GHCR buildée par `veridian-crm-ci.yaml`.

## À faire
1. Lister les .github/workflows/ci-*.yaml et autres upstream qui s'arment sur
   push/pull_request vers main/staging dans notre fork.
2. Les neutraliser proprement : soit retirer les triggers push/PR (garder
   workflow_dispatch), soit les supprimer s'ils sont 100% upstream-only
   (ci-front, ci-ui, ci-new-ui, ci-create-app, ci-server upstream, etc.).
   ⚠️ Ne PAS toucher veridian-crm-ci.yaml (le nôtre).
3. Vérifier qu'aucun de ces workflows upstream n'est référencé par notre CI.
4. Objectif: sur push main/staging, SEUL veridian-crm-ci.yaml tourne → plus de
   faux rouge dans l'historique Actions.

## Note
Repéré pendant la promo prod du merge upstream (2026-06-14) par l'agent ci-fix.
Non bloquant : ces workflows ne gatent rien côté Veridian.
