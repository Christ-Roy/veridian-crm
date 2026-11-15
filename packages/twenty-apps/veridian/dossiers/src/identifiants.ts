// Identifiants universels de l'app. Ils sont la clé de chaque entité d'une installation à l'autre :
// ne jamais en changer un, sinon `app apply` supprime l'entité pour en créer une neuve.

export const APPLICATION_UNIVERSAL_IDENTIFIER = 'dccc9944-ddb7-4019-a95d-ec27679f70ba';
export const DEFAULT_ROLE_UNIVERSAL_IDENTIFIER = '6b663331-94a6-4157-83da-b3313178ad4c';
export const ARBORESCENCE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER = '7d9705e3-79db-42e7-8d5d-9f54a685c311';
export const TACHES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER = '1af115ac-6cc7-46f0-aaf9-10d16d7c89b8';
export const TACHES_PAGE_LAYOUT_TAB_UNIVERSAL_IDENTIFIER = '2484f09e-72f5-45e8-9778-890f8b93239b';
export const TACHES_WIDGET_UNIVERSAL_IDENTIFIER = '029a6a2b-083c-4646-83a5-ef3e6c7a867b';
export const TACHES_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER = 'ef218efa-2fd2-4610-979c-ecce85033746';

// Objet Dossier (15/11/2026) : un enregistrement par dossier, parent vide = dossier racine (sujet).
export const DOSSIER_UNIVERSAL_IDENTIFIER = '2f16f107-6a08-41c4-ae58-453a7eda3d11';
export const DOSSIER_FIELDS = {
  nom: '2f173ddf-51bb-46a1-a28f-955daf31f4c8',
  importance: '99a17d60-411f-486e-9e83-fb24dd0f40c9',
  categorie: 'e910f084-e471-465e-99aa-faad7730eb83',
} as const;

// Les trois grandes catégories de dossiers (Robert, 15/11/2026). Figées dans le code : jamais éditées dans l'UI.
export const CATEGORIE_OPTION_IDS = {
  CLIENT: 'f72b2b30-0022-457b-9d4f-76cd0e3ca892',
  INTERNE: '289792a2-877c-4d04-96c1-9a1084b0b4ba',
  PROSPECTION: 'd5615332-3fac-48d5-a3e0-cc14facdc8d2',
} as const;
export const PARENT_ON_DOSSIER_UNIVERSAL_IDENTIFIER = 'bafd737d-dd53-4014-96fd-1e893ac9e25e';
export const SOUS_DOSSIERS_ON_DOSSIER_UNIVERSAL_IDENTIFIER = 'afba07a5-a872-4589-b77b-92ac1af480d6';
export const TACHES_ON_DOSSIER_UNIVERSAL_IDENTIFIER = 'b83bd39d-4b3c-4f76-9ace-fea51161812e';
export const RANGEMENT_ON_TASK_UNIVERSAL_IDENTIFIER = 'b2d14820-f844-46bc-b69e-7e99f93cd421';
export const IMPORTANCE_ON_TASK_UNIVERSAL_IDENTIFIER = '31d26485-ebb0-4075-9a2f-58d91db7bfde';

// Les identifiants d'option sont uniques par champ : un jeu pour Dossier, un pour Task.
export const IMPORTANCE_OPTION_IDS = {
  dossier: {
    CRITIQUE: 'd6efbb2d-f1ec-4bc1-bb46-b5ed167b82b3',
    HAUTE: '3408dde6-1f4d-4a50-b00f-46868fe20be1',
    NORMALE: '41035408-3adf-4139-b46f-f36841e0d192',
    BASSE: '429f72ef-fe6e-41ae-85b6-ebf24091983b',
  },
  task: {
    CRITIQUE: '5d0133a6-0447-40e0-8883-a7976be0bda6',
    HAUTE: '1049b9b5-673b-4ef6-a0c4-20daf041e97c',
    NORMALE: '24e88f0c-25fe-4bbc-8d69-f58b38b29254',
    BASSE: 'b910351b-0cae-49c4-a4a9-5b2cde325565',
  },
} as const;
