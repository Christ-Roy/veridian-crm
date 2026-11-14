import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import {
  DOSSIER_UNIVERSAL_IDENTIFIER,
  PARENT_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  SOUS_DOSSIERS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

export default defineField({
  universalIdentifier: SOUS_DOSSIERS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'sousDossiers',
  label: 'Sous-dossiers',
  icon: 'IconFolders',
  relationTargetObjectMetadataUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: PARENT_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
