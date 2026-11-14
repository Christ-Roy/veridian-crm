import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import {
  TACHES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  TACHES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// Remplace l'entrée native « Tasks » de la barre latérale (retirée à l'installation, voir README).
export default defineNavigationMenuItem({
  universalIdentifier: TACHES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Tâches',
  icon: 'IconCheckbox',
  color: 'turquoise',
  position: 3,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: TACHES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});
