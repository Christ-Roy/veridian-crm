import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';

import { PRODUCTION_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER, VUES_TACHES } from '../identifiants';

// « Production » : le travail des agents et des IA (nature IA).
export default defineNavigationMenuItem({
  universalIdentifier: PRODUCTION_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'Production',
  icon: 'IconRobot',
  color: 'purple',
  position: 3.6,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: VUES_TACHES.IA_TABLEAU,
});
