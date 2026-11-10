import {
  definePageLayoutTab,
  PageLayoutTabLayoutMode,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { APPELS_ON_PERSON_UNIVERSAL_IDENTIFIER, APPELS_TAB_UNIVERSAL_IDENTIFIER, APPELS_TAB_WIDGET_UNIVERSAL_IDENTIFIER, APPELS_PERSONNE_VIEW } from '../identifiants';

// Onglet « Appels » de la fiche Person, après Calendar : la relation en tableau, du plus récent au plus ancien.
export default definePageLayoutTab({
  universalIdentifier: APPELS_TAB_UNIVERSAL_IDENTIFIER,
  pageLayoutUniversalIdentifier:
    STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.personRecordPage.universalIdentifier,
  title: 'Appels',
  position: 1000,
  icon: 'IconPhone',
  layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
  widgets: [
    {
      universalIdentifier: APPELS_TAB_WIDGET_UNIVERSAL_IDENTIFIER,
      title: 'Appels',
      type: 'FIELD',
      heightBehavior: 'TAB_VIEWPORT',
      configuration: {
        configurationType: 'FIELD',
        fieldMetadataId: APPELS_ON_PERSON_UNIVERSAL_IDENTIFIER,
        fieldDisplayMode: 'TABLE',
        viewId: APPELS_PERSONNE_VIEW.view,
      },
    },
  ],
});
