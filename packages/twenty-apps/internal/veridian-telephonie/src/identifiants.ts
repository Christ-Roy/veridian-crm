// Identifiants universels de l'app. Ils sont la clé de chaque entité d'une installation à l'autre :
// ne jamais en changer un, sinon `app apply` supprime l'entité et ses données pour en créer une neuve.

export const APPLICATION_UNIVERSAL_IDENTIFIER =
  'e3df4b02-559e-4624-b985-3fd49cfd1725';

export const APPEL_UNIVERSAL_IDENTIFIER = '8d1e346b-1ba1-4f4f-baaa-5218e2984a41';

export const APPEL_FIELDS = {
  titre: '3f799512-a88a-4363-8a6e-ffa17010fcfc',
  direction: 'bd0560d8-dcf4-4387-ad3f-bc4c7a720eee',
  canal: 'a4cfcff6-e7a4-4273-bdc7-b78da6e3f219',
  debutLe: '1a0c0993-8e30-4189-8e34-a8e83c353632',
  dureeSecondes: 'd322ffd4-fc24-4c5e-a3ba-0c9d4c6f5a5b',
  numero: '1d52b320-fb60-4703-bcb7-49e20ea15b01',
  nomSurTelephone: '3f44eb7f-122e-411d-a509-e5b390be1691',
  enregistrement: 'c01c8436-0ce4-4d41-b142-e067326f3236',
  transcription: '8ca9cedb-05a0-4669-8a60-7464c055f8b1',
  appareil: '039033a6-6934-488c-b742-b6a8af1c9b5a',
  idSource: '323e6bd9-4944-4346-96fc-aad87f082c0b',
} as const;

export const PERSON_ON_APPEL_UNIVERSAL_IDENTIFIER =
  '6717eeca-4c85-413b-a5a8-107729c5b158';
export const APPELS_ON_PERSON_UNIVERSAL_IDENTIFIER =
  '5b654a41-7751-47d2-990d-f85080806774';

export const TEXT_MESSAGE_UNIVERSAL_IDENTIFIER =
  '314a8223-f09f-4c06-af2a-2b78b8a13ae0';

export const TEXT_MESSAGE_FIELDS = {
  apercu: '9070e567-e403-47cf-8a5e-09c4d6a3f359',
  texte: 'e4634a2e-7ef5-4ad2-b2f6-c153b4c0692a',
  sens: '725581d7-b083-4aea-aeb7-c2b8a3b7c68d',
  canal: '232c1d52-8b73-4ee7-badb-a5024709c1b1',
  envoyeLe: '6cb81424-c04c-4f0a-a303-6a7ac089bf06',
  numero: '4ae44482-5b22-44a3-bd15-742b41b21952',
  nomSurTelephone: '7712a05c-fcb4-4371-b3c7-87a278e2437a',
  piecesJointes: '5ba4ce60-1e5b-4abc-86c8-e5fa019a077c',
  appareil: 'f6b8a1b0-300c-426f-8bfc-86dc4d221033',
  idSource: '9bf7d5b1-b07c-4246-b540-6b639f751b3a',
} as const;

export const PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER =
  '4a6526ac-bbe8-4226-98d3-1d3cb7ad0f45';
export const TEXT_MESSAGES_ON_PERSON_UNIVERSAL_IDENTIFIER =
  'eff11065-0c71-4108-8d6a-c9fbc6cb9496';

export const APPEL_LINKED_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIER =
  '85be64c1-4057-4bc1-a2f7-b4a160ee1999';
export const TEXT_MESSAGE_LINKED_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIER =
  'ffb00bad-6200-43ac-a7bb-bb2dcac8d8a8';

export const APPELS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER =
  'dbd38f4a-5352-4b80-9521-4d301b5c4753';
export const TEXT_MESSAGES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER =
  '40a33bf8-e626-4c97-82d2-00f700100583';

export const DEFAULT_ROLE_UNIVERSAL_IDENTIFIER =
  '9e86979b-b988-449f-8a81-b607b10234f8';
