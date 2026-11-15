import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import {
  DEVIS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  DEVIS_UNIVERSAL_IDENTIFIER,
  DOSSIER_ON_DEVIS_UNIVERSAL_IDENTIFIER,
  DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

export default defineField({
  universalIdentifier: DEVIS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'devis',
  label: 'Devis',
  icon: 'IconFileInvoice',
  relationTargetObjectMetadataUniversalIdentifier: DEVIS_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: DOSSIER_ON_DEVIS_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
