# Isolation des fonctions d'app (logic functions) — 18/11/2026

**État (18/11, 14:20 UTC)** : LOCAL avec garde du fork (72d2f21e02) : seuls les couples (espace, app) de
`VERIDIAN_LOGIC_FUNCTION_ALLOW` s'exécutent, aujourd'hui veridian-4 + Google Meet. Prouvé en prod : liste vide = tout
refusé (Meet compris) ; liste posée = Meet exécuté dans veridian-4 (1,5 à 3,2 s), sonde d'un autre espace refusée (403),
Meet installé dans un autre espace refusé (3 ms), identifiant de Meet recopié refusé dès l'enregistrement.
Option A (exécuteur isolé, pour les fonctions des clients) : ROB-237.

**Pourquoi coupé** : en LOCAL, une app déposée par n'importe quel propriétaire d'espace (`twenty app apply` avec sa propre
clé, 4 propriétaires externes en prod, et tout inscrit du Hub en crée un) exécute son code sur le serveur CRM.
Mesuré le 18/11 par une sonde (espace jetable, booléens seulement) : environnement filtré (11 variables, aucun secret du
serveur), disque fermé (permissions Node), Redis/Nomad/Consul/métadonnées injoignables, **mais pg-saas
(172.26.64.1:15432) joignable en TCP**. Exécution de code arbitraire offerte à un inscrit, pivot réseau vers la base.

**Pour rétablir** : un exécuteur isolé (pas d'environnement serveur, pas de route vers pg-saas ni vers le tailnet), par
exemple un conteneur dédié sans réseau interne, ou couper la création d'apps par les espaces externes. Décision à prendre
(parente / Robert). D'ici là, l'import Meet de Robert passe par un job hors du CRM s'il est urgent.

**Preuve attendue** : la sonde de `veridian-crm-apps` (CLAUDE.md, « Prouver ») rejouée depuis un espace jetable ne joint
plus pg-saas.
