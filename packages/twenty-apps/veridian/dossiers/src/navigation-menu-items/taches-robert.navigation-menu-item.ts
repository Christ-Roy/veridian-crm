import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { TACHES_HUMAIN_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER, VUES_TACHES } from '../identifiants';

// « Tâches » : le temps de Robert (nature HUMAIN), tableau par défaut ; le kanban des priorités est dans le
// sélecteur de vues de la page.
export default defineNavigationMenuItem({
  universalIdentifier: TACHES_HUMAIN_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Tâches',
  icon: 'IconUserCheck',
  color: 'turquoise',
  position: 3.3,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: VUES_TACHES.HUMAIN_TABLEAU,
});
