# Ouverts au retour sur v2.56.1

- 4 HIGH avec correctif dans l'image `staging-d68c556` (`trivy image --severity CRITICAL,HIGH --ignore-unfixed`) : à rescanner sur l'image servie et traiter.
- `trivy` absent de l'image du runner de build : le scan CI sort « non abouti » tant qu'il n'y est pas (dépôt `nomad-veridian`, images/actions-runner).
- Menu « Create Workspace » encore visible alors que le serveur refuse : à retirer du front.
- `VERIDIAN-PATCHES.md`, section « Retiré ou reporté » : fonctions à reprendre si Robert relance le workspace Veridian.
