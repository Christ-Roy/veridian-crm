# Piège CI : `workflow_run` ne s'arme pas depuis une branche non-défaut

> **Sévérité** : 🟡 P1 (bloque la chaîne staging build→deploy automatique)
> **Owner** : agent veridian-crm
> **Créé** : 2026-06-11

## Symptôme (observé 2026-06-11)
CI staging VERTE sur `staging` (SHA 4f82fd17) → mais `veridian-crm-build-image`
ne s'est **jamais déclenché** automatiquement. Conséquence : le container
`crm.staging.veridian.site` est resté 21h sur l'ancienne image, aucune
validation visuelle possible.

## Cause
GitHub Actions n'évalue le contenu d'un workflow `on: workflow_run` que tel
qu'il existe sur la **branche par défaut du repo** (`main`). Le filtre
`branches: [staging]` du déclencheur fonctionne, MAIS la chaîne
`workflow_run` est notoirement **non fiable / silencieuse** quand le workflow
amont tourne sur une branche ≠ défaut, surtout pour les forks et quand le
workflow a été ajouté récemment. Résultat : CI verte sur staging → aucun
`workflow_run` émis → build-image jamais armé → staging-deploy jamais armé.

C'est une cascade : `ci → build-image → staging-deploy` repose sur DEUX
maillons `workflow_run`, donc DEUX points de rupture.

## Contournement immédiat (validé 2026-06-11)
Les deux workflows ont un `workflow_dispatch`. Quand la CI staging est verte
sans que le build ne démarre :
```bash
gh workflow run veridian-crm-build-image.yaml --repo Christ-Roy/veridian-crm --ref staging -f ref=staging
# attendre le build (job "Build & push" success — Trivy fail = non bloquant, cf ticket Trivy)
gh workflow run veridian-crm-staging-deploy.yaml --repo Christ-Roy/veridian-crm --ref staging
```

## Fix durable à évaluer (pas ce sprint)
Option A — chaîner DANS le même workflow : ajouter les jobs build-image +
staging-deploy comme jobs `needs:` à la fin de `veridian-crm-ci.yaml`
(déclenché par `push`, fiable), au lieu de 2 workflows `workflow_run`
séparés. Supprime les 2 maillons fragiles.
Option B — garder les workflows séparés mais déclencher build-image sur
`push: [staging]` directement (avec un gate "CI verte" via `needs` ou un job
qui attend la conclusion CI). Moins propre qu'A.

Reco : **Option A** au prochain passage CI (un seul `push`-triggered workflow,
zéro `workflow_run`). À coordonner avec le lead (touche la CI = structurel).
