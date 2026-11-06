# Dettes & améliorations repérées pendant le chantier timeline/vues tunnel

> **Sévérité** : 🟢 P2 (dettes non bloquantes, repérées en passant)
> **Owner** : agent veridian-crm
> **Créé** : 2026-06-11
> **Contexte** : observations faites pendant l'implémentation du rendu timeline
> tunnel + vues KANBAN + validation visuelle prod (sprint V1).

## 1. CI front lance TOUTE la suite (~5000 tests) au lieu des specs scopées
Le job `veridian-front-unit` (et `veridian-server-unit`) passe
`--testPathPattern="\.veridian\.spec…"` mais **nx l'ignore** : 4964 tests front
ont tourné (toute la suite), pas seulement mes 4 specs. Idem côté server (5145
tests). Cause probable : jest 30 a renommé `--testPathPattern` →
`--testPathPatterns` (pluriel). Conséquence : chaque push = ~6 min de tests
front au lieu de quelques secondes. **Fix** : passer le pattern via la bonne
syntaxe nx/jest 30, OU scoper via un projet jest dédié. Vérifier que le scope
ne casse pas (le job server fait pareil aujourd'hui, accepté). Non bloquant
mais coûteux en temps CI à chaque commit.

## 2. Onboarding workspace force un parcours Create profile / Sync emails / Invite team
Au 1er login sur un workspace (vu sur staging veridian), Twenty impose 3 modals
avant d'accéder aux données : Create profile, "Emails and Calendar" sync,
"Invite your team". Le modal Invite team pré-remplit `tim@apple.com` etc.
(placeholders du seed). **Risque** : un agent ou un user pressé qui clique
"Finish" au lieu de "Skip" pourrait déclencher des invitations email. Pour
notre usage (workspace déjà onboardé en prod) c'est OK, mais à garder en tête
pour tout NOUVEAU workspace provisionné (cf consigne délivrabilité Robert).
**Reco** : documenter dans le skill admin-twenty que le provisioning d'un
nouveau workspace via UI passe ces modals — toujours "Skip"/"Continue without
sync". (Le provisioning par API du skill ne les déclenche pas.)

## 3. Le seed Twenty laisse des objets/vues de démo dans le workspace prod
Le workspace veridian prod (et staging) contient encore des objets seed :
`Rockets`, `Pets`, `Survey results`, `Employment Histories`, `Pet Care
Agreements`, `Star History`, + companies Apple/Google/Meta de démo, + la vue
KANBAN seed `By Stage` sur opportunity. Ça pollue la nav commerciale.
**Reco** : passe de nettoyage des objets/vues/records de démo avant mise en
main commerciale (hors scope tunnel, mais visible). À trancher avec Robert
(certains objets custom pourraient être réutilisés).

## 4. `healthz` Twenty ment (déjà connu, re-confirmé)
Pendant la promo prod, `healthz` est repassé 200 ~10s AVANT que `/metadata`
réponde 200 (DB pas encore prête). Confirme le piège déjà documenté skill :
**toujours gater le smoke sur `/metadata`, jamais `healthz` seul**. Le
`veridian-crm-staging-deploy.yaml` smoke sur healthz + /metadata — vérifier que
le smoke prod (s'il existe) fait pareil.

## 5. `Created by` affiche "Tunnel Bridge Key — lea…" (tronqué) sur les records bridge
Cosmétique : les records écrits par l'API key du bridge affichent
`Created by: Tunnel Bridge Key — lea…` (le nom de l'API key, tronqué). Lisible
mais peu parlant pour un commercial. Non bloquant — le filtre de bruit
`person.updated{score}` règle déjà le gros du problème de lisibilité.
