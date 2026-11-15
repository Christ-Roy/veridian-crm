# Dossiers Veridian (app Twenty)

Les tâches du CRM rangées en arborescence : **Sujet, puis sous-sujet, puis tâches**. Une page « Tâches » remplace
l'entrée native « Tasks » de la barre latérale (Robert, 14-15/11/2026 : une seule vue, celle d'un dossier).

## Ce que l'app installe

| Entité | Rôle |
|---|---|
| objet `dossier` (Dossiers) | `nom`, **`importance` obligatoire** (Critique, Haute, Normale, Basse ; Normale par défaut), **`categorie` obligatoire** (Client, Interne, Prospection ; Interne par défaut ; seule celle du dossier racine compte, un sous-dossier la reprend à sa création), `parent` (vide = dossier racine), `sousDossiers`, `taches` |
| relation `dossier.societe` ↔ `company.dossiers` | un dossier client est relié à sa fiche société, qui garde l'historique (timeline, notes, mails, encaissements) ; bouton « Fiche » dans la page. 15/11 : un dossier Client par client payant (les 14 sociétés `typeRelation = CLIENT`, recoupées avec le registre des factures de `~/Bureau/comptabilité/README.md`) |
| listes de prospects | dans la section Prospection, liens vers les vues de sociétés dont le nom commence par « Vente en ligne » ou « Site vitrine » (retrouvées par leur nom) ; leurs dossiers de barre latérale ont été retirés le 15/11 (sauvegarde `~/backups-froid/crm-veridian4-navigation-20261115.json`) |
| les trois catégories | Robert, 15/11/2026 : trois grandes sections de to-do dans la page, dans l'ordre Client, Interne, Prospection, chacune avec compteurs, avancement agrégé et « + Dossier » ; la pastille de catégorie d'un dossier racine le déplace d'un clic. Valeurs figées dans le code de l'app, jamais éditées dans l'UI |
| champs sur `task` | `rangement` (« Rangée dans », relation vers Dossier) et **`importance` obligatoire** (mêmes niveaux, Normale par défaut) |
| front component `arborescence-taches` | la page : dossiers repliables à profondeur libre, triés par importance puis nom ; tâches triées ouvertes, importance, échéance ; **avancement** par tâche (champ existant `suiviAvancement`, +25 % par clic) et **par dossier** (moyenne de toutes ses tâches, sous-dossiers compris, une tâche faite compte 100 %, « — » sans tâche) ; importance et statut changés d'un clic ; « + Dossier », « + Sous-dossier », « + Tâche », « Modifier » ; recherche ; faites masquées par défaut ; clic sur une tâche = panneau latéral natif |
| page layout `STANDALONE_PAGE` « Tâches » | héberge le composant en pleine page (`TAB_VIEWPORT`) |
| entrée de barre latérale « Tâches » | `PAGE_LAYOUT`, position 3 (l'entrée native « Tasks » a été retirée) |
| rôle d'app | lecture et modification, jamais de suppression (le jeton du composant est l'intersection de ce rôle et de celui du membre) |

Aucun patch du fork, aucune fonction serveur : uniquement le mécanisme natif des apps Twenty v2.56 (`twenty-sdk`).

## Le modèle de données

Depuis le 15/11/2026, un dossier est un **enregistrement** de l'objet Dossier : en créer un n'est jamais une migration
de schéma (cause du piège ci-dessous). Une tâche dont le dossier manque apparaît dans « Sans dossier » : rien ne
disparaît de la vue. Logique pure dans `src/utils/construire-arbre.util.ts`, éprouvée par `node essai-arbre.mjs`
(12 cas, code 0 ; vue échouer sur une attente faussée).

Migration du 15/11 : les 10 options de l'ancien champ SELECT `dossier` sont devenues 14 dossiers, les 131 tâches
rattachées par `rangement` ; l'ancien rangement est sauvegardé dans
`~/backups-froid/crm-veridian4-dossier-select-20261115.json` (bastion). Le champ SELECT `dossier` n'est plus lu ; il
reste à désactiver.

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
