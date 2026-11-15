# Dossiers Veridian (app Twenty)

Les tâches du CRM rangées en arborescence : **Sujet, puis sous-sujet, puis tâches**. Trois entrées de barre latérale
(Robert, 15/11/2026) : **Projets** (page de l'app : arbre des dossiers ou Gantt, devis et encaissé, dépendances),
**Tâches** (le temps de Robert, nature HUMAIN) et **Production** (le travail des agents et des IA, nature IA), ces deux
dernières en vues natives tableau et kanban. L'entrée native « Tasks » a été retirée le 14/11.

## Ce que l'app installe

| Entité | Rôle |
|---|---|
| objet `dossier` (Dossiers) | `nom`, **`importance` obligatoire** (Critique, Haute, Normale, Basse ; Normale par défaut), **`categorie` obligatoire** (Client, Interne, Prospection ; Interne par défaut ; seule celle du dossier racine compte, un sous-dossier la reprend à sa création), `parent` (vide = dossier racine), `sousDossiers`, `taches` |
| relation `dossier.societe` ↔ `company.dossiers` | un dossier client est relié à sa fiche société, qui garde l'historique (timeline, notes, mails, encaissements) ; bouton « Fiche » dans la page. 15/11 : un dossier Client par client payant (les 14 sociétés `typeRelation = CLIENT`, recoupées avec le registre des factures de `~/Bureau/comptabilité/README.md`) |
| listes de prospects | dans la section Prospection, liens vers les vues de sociétés dont le nom commence par « Vente en ligne » ou « Site vitrine » (retrouvées par leur nom) ; leurs dossiers de barre latérale ont été retirés le 15/11 (sauvegarde `~/backups-froid/crm-veridian4-navigation-20261115.json`) |
| les trois catégories | Robert, 15/11/2026 : trois grandes sections de to-do dans la page, dans l'ordre Client, Interne, Prospection, chacune avec compteurs, avancement agrégé et « + Dossier » ; la pastille de catégorie d'un dossier racine le déplace d'un clic. Valeurs figées dans le code de l'app, jamais éditées dans l'UI |
| champs sur `task` | `rangement` (« Rangée dans », relation vers Dossier) et **`importance` obligatoire** (mêmes niveaux, Normale par défaut) |
| **`task.nature`** obligatoire | HUMAIN (« Robert » : rendez-vous client, appels pour débloquer un jalon, décisions, gestes physiques) ou IA (« Production » : exécuté par des agents ou des IA). HUMAIN par défaut : une tâche non classée tombe chez Robert, où elle se voit. Valeurs figées dans le code |
| préparer un événement d'agenda | `task.besoinAgenda` (Aucun, Rendez-vous, Appel ; obligatoire, Aucun par défaut), `task.dureeEstimee` (minutes ; 7 h = 1 jour de Gantt), `task.aContacter` ↔ `person.tachesAContacter`. **Rien ne crée d'événement** : l'agenda de Robert ne se remplit jamais tout seul ; une IA pourra s'en servir pour proposer |
| objet `devis` (Devis) | `numero`, `dateDevis`, `objet`, `montant` (vide si fourchette ou abonnement), `statut` (Brouillon, Envoyé, Signé, Refusé, Remplacé), **`encaissement`** distinct (Rien reçu, Partiel, Total, Non vérifié ; Non vérifié par défaut et jamais compté), `montantEncaisse`, `preuve` (source et date), `dossier` |
| objet `dependance` | `tache` (la tâche qui attend) et `prerequis` (la tâche attendue), côté tâche `prerequis` (« Attend ») et `bloque` ; suppression d'une tâche = suppression de ses liens |
| vues natives des tâches | « Tâches » et « Tâches · priorités » (HUMAIN), « Production » et « Production · priorités » (IA) : tableau trié par importance puis échéance, kanban groupé par **importance** (glisser-déposer pour ranger les priorités), tâches faites filtrées. Identifiants des colonnes, filtres, tris et groupes dérivés de graines fixes (`uuid-stable.util.ts`) |
| entrées « Tâches » et « Production » | `VIEW`, positions 3,3 et 3,6 ; la barre latérale affiche le **nom de la vue** (le `name` de l'entrée est ignoré) |
| front component `arborescence-taches` (page Projets) | 15/11 : **devis** sous chaque dossier (montant, encaissé, preuve au survol) et pastille « n devis · promis · encaissé » ; **signal** « Client sans encaissement prouvé » et « Prospection avec encaissé » (encaissé = devis Partiel ou Total, ou `totalEncaisseProuve` de la fiche société) ; pastille de **nature** cliquable ; bouton **⇠ attend · bloque ⇢** qui ouvre ce que la tâche attend et bloque et permet d'**ajouter un prérequis** par recherche (refusé s'il fermerait une boucle ; retirer un lien : dans la fiche) ; tâches en **boucle** et **jalons sans date** signalés ; bascule **Arbre / Gantt** (jalons en losanges à leur échéance, tâches datées en barres pleines, sans date en pointillés placées après leurs prérequis, retards en rouge, prérequis après l'échéance cerclé orange). Logique dans `planning.util.ts` et `devis.util.ts`. Avant : la page : dossiers repliables à profondeur libre, triés par importance puis nom ; tâches triées ouvertes, importance, échéance ; **avancement** par tâche (champ existant `suiviAvancement`, +25 % par clic) et **par dossier** (moyenne de toutes ses tâches, sous-dossiers compris, une tâche faite compte 100 %, « — » sans tâche) ; importance et statut changés d'un clic ; « + Dossier », « + Sous-dossier », « + Tâche », « Modifier » ; recherche ; faites masquées par défaut ; clic sur une tâche = panneau latéral natif |
| page layout `STANDALONE_PAGE` « Projets » (ex-« Tâches ») | héberge le composant en pleine page (`TAB_VIEWPORT`) |
| entrée de barre latérale « Projets » (ex-« Tâches ») | `PAGE_LAYOUT`, position 3 |
| rôle d'app | lecture et modification, jamais de suppression (le jeton du composant est l'intersection de ce rôle et de celui du membre) |

Aucun patch du fork, aucune fonction serveur : uniquement le mécanisme natif des apps Twenty v2.56 (`twenty-sdk`).

## Le modèle de données

Depuis le 15/11/2026, un dossier est un **enregistrement** de l'objet Dossier : en créer un n'est jamais une migration
de schéma (cause du piège ci-dessous). Une tâche dont le dossier manque apparaît dans « Sans dossier » : rien ne
disparaît de la vue. Logique pure dans `src/utils/construire-arbre.util.ts`, éprouvée par `node essai-arbre.mjs`
(39 cas au 15/11 : arbre, ordonnancement du Gantt, boucles, devis ; code 0. Les 23 nouveaux cas vus échouer contre un
bouchon vide puis contre un bouchon inverse avant la vraie logique).

## Données du 15/11/2026 (sauvegarde `~/backups-froid/crm-veridian4-avant-nature-devis-20261115-1403.json`)

- **25 devis** (2026-001 à 2026-025) importés du registre `~/Bureau/comptabilité/README.md`, chacun relié à son
  dossier. Encaissement : Partiel ou Total seulement avec une preuve (relevé CIC …001 exports du 05/09 et du 10/11
  dans `~/veridian/crm-reprise/releves/`, facture payée à l'index, fiche CRM) ; tout le reste en Non vérifié, jamais
  Total par défaut. 2026-020 remplacé par 2026-024. Les échéances AVSE sont portées sur 2026-012, pas sur 2026-017.
- **7 dossiers Prospection** créés, reliés à leur société : JAMFYM, N-RYAN, Djams, FGMC, RETOUR D'EST, CASA SOFIA,
  SUPPORTERS CLUB DE FRANCE.
- **Nature des 131 tâches** (règle dans l'ordre) : « R… » ou `suiviQui` ROBERT = HUMAIN ; « A… » ou ASD = HUMAIN avec
  Appel (action attendue du client que Robert relance ; Hugo Bourdat et Romain Paveglio en contact quand nommés) ;
  « N… », « J… » ou NOUS = IA ; « Demo… » = IA ; « Rappel… », « Relance… » = HUMAIN avec Appel ; dossiers CRM et
  Réseau de la flotte = IA ; Matériel et téléphones = HUMAIN. Résultat : 39 HUMAIN, 92 IA.

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
