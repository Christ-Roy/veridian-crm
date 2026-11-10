import {
  definePageLayoutTab,
  PageLayoutTabLayoutMode,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { TEXT_MESSAGES_ON_PERSON_UNIVERSAL_IDENTIFIER, SMS_TAB_UNIVERSAL_IDENTIFIER, SMS_TAB_WIDGET_UNIVERSAL_IDENTIFIER, SMS_PERSONNE_VIEW } from '../identifiants';

// Onglet « SMS » de la fiche Person, après Calendar : la relation en tableau, du plus récent au plus ancien.
export default definePageLayoutTab({
  universalIdentifier: SMS_TAB_UNIVERSAL_IDENTIFIER,
  pageLayoutUniversalIdentifier:
    STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.personRecordPage.universalIdentifier,
  title: 'SMS',
  position: 1010,
  icon: 'IconMessage',
  layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
  widgets: [
    {
      universalIdentifier: SMS_TAB_WIDGET_UNIVERSAL_IDENTIFIER,
      title: 'SMS',
      type: 'FIELD',
      heightBehavior: 'TAB_VIEWPORT',
      configuration: {
        configurationType: 'FIELD',
        fieldMetadataId: TEXT_MESSAGES_ON_PERSON_UNIVERSAL_IDENTIFIER,
        fieldDisplayMode: 'TABLE',
        viewId: SMS_PERSONNE_VIEW.view,
      },
    },
  ],
});
