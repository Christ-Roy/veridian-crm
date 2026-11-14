import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import {
  ARBORESCENCE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  TACHES_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
  TACHES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  TACHES_WIDGET_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

export default definePageLayout({
  universalIdentifier: TACHES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Tâches',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: TACHES_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Tâches',
      position: 0,
      icon: 'IconCheckbox',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: TACHES_WIDGET_UNIVERSAL_IDENTIFIER,
          title: 'Tâches',
          type: 'FRONT_COMPONENT',
          heightBehavior: 'TAB_VIEWPORT',
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier: ARBORESCENCE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
