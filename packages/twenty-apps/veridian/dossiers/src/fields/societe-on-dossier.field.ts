import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  DOSSIER_UNIVERSAL_IDENTIFIER,
  DOSSIERS_ON_COMPANY_UNIVERSAL_IDENTIFIER,
  SOCIETE_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// La société d'un dossier client : sa fiche garde l'historique (timeline, notes, mails, encaissements),
// même quand le projet est livré. Société supprimée : le dossier reste.
export default defineField({
  universalIdentifier: SOCIETE_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'societe',
  label: 'Société',
  icon: 'IconBuildingSkyscraper',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: DOSSIERS_ON_COMPANY_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'societeId',
  },
});
