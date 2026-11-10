import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import { APPEL_UNIVERSAL_IDENTIFIER, APPELS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER } from '../identifiants';

export default defineNavigationMenuItem({
  universalIdentifier: APPELS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  position: 0,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: APPEL_UNIVERSAL_IDENTIFIER,
});
