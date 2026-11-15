import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import {
  TACHES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  TACHES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// « Projets » (ex-« Tâches », renommée le 15/11/2026) : l'arbre des dossiers, devis, dépendances et Gantt.
export default defineNavigationMenuItem({
  universalIdentifier: TACHES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Projets',
  icon: 'IconFolders',
  color: 'turquoise',
  position: 3,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: TACHES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});
