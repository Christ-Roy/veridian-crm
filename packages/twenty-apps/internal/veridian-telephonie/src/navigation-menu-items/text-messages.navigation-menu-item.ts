import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import { TEXT_MESSAGE_UNIVERSAL_IDENTIFIER, TEXT_MESSAGES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER } from '../identifiants';

export default defineNavigationMenuItem({
  universalIdentifier: TEXT_MESSAGES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER,
  position: 1,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
});
