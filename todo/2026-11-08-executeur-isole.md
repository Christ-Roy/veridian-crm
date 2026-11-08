# Exécuteur isolé pour les fonctions des apps Twenty (après Patroni)

Décision de la parente, 08/11/2026, reco de la session Twenty : à faire après la HA Patroni.

## Pourquoi

Robert veut des fonctions avec variables d'environnement pour que les agents clients fassent des traitements côté
serveur. Twenty 2.56 sait les déclarer (apps `twenty-sdk`, variables d'application) mais n'a que trois exécuteurs :
`DISABLED` (défaut en prod, le nôtre), `LAMBDA` (AWS, payant) et `LOCAL`. Mesuré : `LOCAL` lance le code client dans un
processus enfant qui hérite de tout l'environnement du serveur (`...process.env` : mot de passe de la base,
`APP_SECRET`, `HUB_API_SECRET`). Interdit en multi-client.

## Ce qu'il faut

- Un pilote `veridian-sandbox` (fichier neuf, AGPL, implémente `LogicFunctionDriver`) ; ajout de la valeur à l'enum et
  à la fabrique (patch amont minimal, inscrit dans `VERIDIAN-PATCHES.md`).
- L'exécution part dans un job Nomad batch isolé : runtime gVisor (`runsc`), aucun secret du serveur, seules les
  variables de l'app, pas d'accès au tailnet ni aux bases, sortie internet seule, limites CPU, mémoire et durée.
- Retirer alors le refus de `CODE` et `LOGIC_FUNCTION` (`veridian-coupures/`) pour ce pilote.

## Fini quand

Une app de test déployée par `twenty app apply` exécute une fonction qui lit sa variable d'app, et la même fonction
échoue à lire `APP_SECRET` ou à joindre `crm-db` : vu échouer, en prod.

## D'ici là

Le bulk passe par l'API : `twenty-admin import` (skill `twenty-cli`), prouvé le 08/11/2026 (250 sociétés).
