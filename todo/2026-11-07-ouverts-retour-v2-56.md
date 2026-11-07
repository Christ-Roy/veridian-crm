# Ouverts au retour sur v2.56.1

- 4 HIGH corrigeables sur `staging-605cd60`, tous sur `@modelcontextprotocol/sdk` 1.30.0 (corrigé en 1.32.0), dépendance amont : à monter avant toute prod, ou à reprendre au prochain sync.
- `trivy` absent de l'image du runner de build : le scan CI sort « non abouti » tant qu'il n'y est pas (dépôt `nomad-veridian`, images/actions-runner).
- Menu « Create Workspace » encore visible alors que le serveur refuse : à retirer du front.
- `VERIDIAN-PATCHES.md`, section « Retiré ou reporté » : fonctions à reprendre si Robert relance le workspace Veridian.
