# Dossiers Veridian (app Twenty)

Les tâches du CRM rangées en arborescence : **Sujet, puis sous-sujet, puis tâches**. Une page « Tâches » remplace
l'entrée native « Tasks » de la barre latérale (Robert, 14-15/11/2026 : une seule vue, celle d'un dossier).

## Ce que l'app installe

| Entité | Rôle |
|---|---|
| front component `arborescence-taches` | la page : dossiers repliables, compteurs ouvertes / total, recherche, faites masquées par défaut, statut changé d'un clic (À faire, En cours, Fait), « + Tâche » qui crée la tâche dans le sous-dossier et l'ouvre, clic sur une tâche = panneau latéral natif |
| page layout `STANDALONE_PAGE` « Tâches » | héberge le composant en pleine page (`TAB_VIEWPORT`) |
| entrée de barre latérale « Tâches » | `PAGE_LAYOUT`, position 3 |
| rôle d'app | lecture et modification des tâches, jamais de suppression (le jeton du composant est l'intersection de ce rôle et de celui du membre) |

Aucun patch du fork, aucune fonction serveur : uniquement le mécanisme natif des apps Twenty v2.56 (`twenty-sdk`).

## Le modèle de données

L'arbre vient du champ SELECT **`dossier`** des tâches (créé hors de l'app, par l'API de métadonnées). Une option
« ASD / Jalons » donne le sujet « ASD » et le sous-sujet « Jalons » ; une option sans « / » donne un sous-dossier
« Général ». L'ordre suit la position des options. Une tâche sans dossier apparaît dans « Sans dossier / À ranger » :
rien ne disparaît de la vue. La logique est dans `src/utils/construire-arbre.util.ts` (fonction pure).

**Nouveau dossier** : ajouter une option au champ Dossier (Réglages, Modèle de données, Tasks, Dossier).

## Piège mesuré le 14/11/2026

À 23 h 20 UTC, une modification du champ Dossier (ajout de l'option « CRM » depuis l'interface,
`update:fieldMetadata` dans les journaux de `crm-server`) a **vidé la valeur Dossier des 129 tâches existantes**, sans
écrire une seule ligne de tâche (`updatedAt` inchangé). Restauré le même soir à partir des règles de rangement.
Rejoué ensuite sur un champ d'essai (API puis formulaire de l'interface) : **valeur conservée**, le déclencheur exact
n'est donc pas reproduit. Tant qu'il ne l'est pas : relire le compte des tâches par dossier après toute modification
des options du champ, et préférer à terme un dossier en **relation** (un enregistrement par dossier, sans
migration de schéma) plutôt qu'en SELECT.

## Commandes (bastion)

```bash
cd packages/twenty-apps/veridian/dossiers
corepack yarn install                         # Node 24 : PATH=~/.local/twenty-cli/node/bin:$PATH
./deployer.sh plan  prod veridian-4           # diff, lecture seule
./deployer.sh apply prod veridian-4           # installe ou met à jour
corepack yarn twenty app typecheck
```

`deployer.sh` lit la clé du workspace dans `~/credentials/.all-creds.env` (`twenty-admin agent:grant`) sans
l'afficher, et applique sans `--prune` (un retrait du source ne supprime rien).

Pièges du déploiement :
- **Un identifiant d'app appartient au premier workspace où on l'applique** sur une instance. L'installer ensuite
  sur un autre workspace de la même instance est refusé (« registered to another workspace ») et le transfert
  (`transferApplicationRegistrationOwnership`) est refusé à une clé API. L'essai sur `innovative-mint-penguin`
  a laissé un enregistrement orphelin, désinstallé (ancien identifiant `66830dff-…`).
- Le client typé est régénéré à chaque `apply` depuis le schéma du workspace : un typecheck peut échouer après coup
  (statut typé `TaskStatusEnum`).
- L'API de métadonnées exige `filter: {}` dans `objects(...)` et `fields(...)`.
