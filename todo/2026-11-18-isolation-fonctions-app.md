# Isolation des fonctions d'app (logic functions) — 18/11/2026

**État** : `LOGIC_FUNCTION_TYPE=DISABLED` en prod depuis le 18/11 (était LOCAL depuis le 16/11, commit ec3e64450b, pour
l'import Google Meet planifié de Robert).

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
