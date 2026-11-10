import {
  defineRole,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  SystemPermissionFlag,
} from 'twenty-sdk/define';

import {
  APPEL_UNIVERSAL_IDENTIFIER,
  TELEPHONE_ROLE_UNIVERSAL_IDENTIFIER,
  TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

const lectureEcriture = {
  canReadObjectRecords: true,
  canUpdateObjectRecords: true,
  canSoftDeleteObjectRecords: false,
  canDestroyObjectRecords: false,
};

// La clé du téléphone ne sort pas de ce périmètre : un téléphone se perd, la clé Admin du CRM n'y vit pas.
export default defineRole({
  universalIdentifier: TELEPHONE_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Téléphone',
  description: 'Clé API du téléphone de Robert : lit les personnes, écrit appels et SMS, téléverse leurs fichiers',
  icon: 'IconDeviceMobile',
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToUsers: false,
  canBeAssignedToAgents: false,
  canBeAssignedToApiKeys: true,
  objectPermissions: [
    {
      objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
    { objectUniversalIdentifier: APPEL_UNIVERSAL_IDENTIFIER, ...lectureEcriture },
    { objectUniversalIdentifier: TEXT_MESSAGE_UNIVERSAL_IDENTIFIER, ...lectureEcriture },
  ],
  permissionFlagUniversalIdentifiers: [SystemPermissionFlag.UPLOAD_FILE],
});
