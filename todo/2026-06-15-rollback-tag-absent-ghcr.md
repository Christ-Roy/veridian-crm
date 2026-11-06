# Le tag :rollback n'est pas créé sur GHCR au deploy main

> **Sévérité** : 🟡 P1 (filet rollback prod manquant)
> **Owner** : agent veridian-crm
> **Créé** : 2026-06-15

## Constat
Lors de la promo prod du sync upstream (2026-06-15), le tag
`ghcr.io/christ-roy/veridian-crm:rollback` était ABSENT — le step
"Retag current :latest as :rollback (main only)" de veridian-crm-ci.yaml
n'a pas produit l'image. On a donc déployé en prod SANS filet rollback
"1 clic" (heureusement pas eu besoin, le sync était sain).

## À faire
1. Lire le step "Retag :latest as :rollback" (veridian-crm-ci.yaml ~L170-176):
   `docker buildx imagetools create -t $IMG:rollback $IMG:latest` gardé derrière
   un `if docker buildx imagetools inspect $IMG:latest`. Vérifier pourquoi il a
   skippé/échoué (auth GHCR du step? :latest pas encore présent au moment du retag?
   ordre des jobs?).
2. Garantir qu'à CHAQUE build main, l'ancienne :latest est bien re-taggée :rollback
   AVANT d'être écrasée. Tester sur un push main.
3. Lié à la tâche pin-SHA (#4): si on passe au pin par SHA, le rollback devient
   "compose.update vers le SHA précédent" (déterministe) et ce :rollback mouvant
   devient moins critique — mais garder un filet propre.

## Non bloquant
Prod actuelle saine. Backup DB prod dispo en filet ultime.
