// Identifiants universels de l'app Google Meet. Ils sont la clé de chaque entité d'une installation à l'autre :
// ne jamais en changer un, sinon `app apply` supprime l'entité pour en créer une neuve (et ses données).

export const APPLICATION_UNIVERSAL_IDENTIFIER = '65f44458-3dde-49de-9b19-c52b60b5d1e8';
export const DEFAULT_ROLE_UNIVERSAL_IDENTIFIER = 'da1a95a1-4dd5-461b-a5ce-c1e2d781d772';

// Deux fournisseurs, comme l'app Teams : le compte Google de chaque membre (USER), sinon un compte partagé (WORKSPACE).
export const CONNEXION_UTILISATEUR_UNIVERSAL_IDENTIFIER = '4eb52393-9643-4225-8895-2b748cbcbe0f';
export const CONNEXION_ESPACE_UNIVERSAL_IDENTIFIER = 'dbf6a8e7-9d32-4163-8005-ddfd9090f436';
export const FOURNISSEUR_UTILISATEUR = 'google-meet-user';
export const FOURNISSEUR_ESPACE = 'google-meet';

export const PANNEAU_MEET_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER = '7c36f405-f034-492c-bff8-ebae79820fe3';
export const IMPORT_GLOBAL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER = 'dc08f4e8-dfea-44f1-961d-094f344b6511';

export const COMMANDE_MEET_PERSONNE_UNIVERSAL_IDENTIFIER = 'cd191eb1-7272-4386-801c-8698bedd816c';
export const COMMANDE_MEET_SOCIETE_UNIVERSAL_IDENTIFIER = 'bb4adfbc-e327-403b-9152-c49dde1d05a6';
export const COMMANDE_MEET_DOSSIER_UNIVERSAL_IDENTIFIER = '1f593fa4-7efd-4857-8c48-e2f6886f31d1';
export const COMMANDE_IMPORT_GLOBAL_UNIVERSAL_IDENTIFIER = '42bea42d-79c8-4aab-a554-4603225a5e6d';

// Objet Dossier, défini par l'app Dossiers Veridian (même instance) : on ne fait que s'y référer.
export const DOSSIER_OBJECT_UNIVERSAL_IDENTIFIER = '2f16f107-6a08-41c4-ae58-453a7eda3d11';

// Objet Réunion Meet : l'état de chaque Meet créé depuis le CRM (de quoi retrouver son compte rendu plus tard).
export const REUNION_MEET_UNIVERSAL_IDENTIFIER = '9b1febc4-3791-43fc-b885-22cc781ee816';
export const REUNION_MEET_FIELDS = {
  titre: 'b3c1a986-bb25-4e05-825a-b658f371eef7',
  debut: 'faf94221-e584-4f71-822b-52de81c59971',
  fin: 'f6d58e18-c683-4b10-be14-952c276270e1',
  lienMeet: '91a58561-fff7-4bf8-86ff-d67f940766c0',
  codeReunion: '8fdc498d-3dce-40be-b7ba-42531b67cd78',
  idEvenementGoogle: '214a09c5-439f-423e-b1cf-ff224d2013f2',
  icalUid: '79717898-7fe9-4d3b-9bd5-d8133959b3e7',
  participants: '676b0d7d-cb57-4d2a-9400-2a3c1ebe3582',
  cibles: '2a941604-5be3-4d80-be25-25e4dfbb24f0',
  statut: '853d3945-2068-411e-9dbf-ef04ca45dde5',
  noteId: '6a5b9fb6-d8af-41d3-8c87-bd2cefaaf968',
  compteGoogle: '27254387-77ff-4fa2-92f1-b148e8d7a93f',
  dernierEssai: '1dd4c719-c4d6-4ddc-9132-b008507c1df0',
  detailImport: '5cfcf209-0c4f-477f-884a-2d1ca03f365d',
  lienEnregistrement: 'fd89d30f-0658-4c4f-81a4-3678799fda2d',
} as const;
export const STATUT_OPTION_IDS = {
  PLANIFIEE: '9d1fd43b-d3c2-45cc-969a-c82bd0ab8e2c',
  EN_ATTENTE: 'd5211117-e9d7-4744-a2ed-0c745b7d4702',
  IMPORTEE: '85f6d90e-23d8-4fea-83da-15997909a04f',
  SANS_TRANSCRIPTION: '84300538-092d-411b-b146-417727f4c67a',
  NON_TENUE: '9d2770c2-707d-4227-a1ea-c0cc0dd40feb',
} as const;
