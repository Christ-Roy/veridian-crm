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
// Dossier ↔ société (15/11/2026) : la fiche société porte l'historique du client.
export const SOCIETE_ON_DOSSIER_UNIVERSAL_IDENTIFIER = 'c717835a-36c4-4003-8273-4dea905cd6cc';
export const DOSSIERS_ON_COMPANY_UNIVERSAL_IDENTIFIER = 'c4e959b7-1106-42ef-9ae9-716395916864';

// Devis (15/11/2026) : ce qui est promis, distinct de ce qui est réellement encaissé.
export const DEVIS_UNIVERSAL_IDENTIFIER = '96052b8e-f973-4190-81e5-331357a2d0d9';
export const DEVIS_FIELDS = {
  numero: '1af06cb7-7452-4a97-9898-9501c5e77168',
  date: 'c8ba6f6b-9713-4426-a2ae-23156f5569db',
  objet: '14e318d0-bcbc-4b9a-8fee-ea6529eb3cf0',
  montant: '2492e9ff-eff4-439b-9b1c-ea9314735410',
  statut: '8107483c-db6d-4d34-b563-bfa17ab4bbf7',
  encaissement: '371d9da3-ff26-4580-b360-06d15a77fe43',
  montantEncaisse: '443473cf-fedf-463f-b82b-4e37049b3894',
  preuve: '2c75dde3-1d96-4d0e-8449-3a1e8420bc74',
} as const;
export const STATUT_DEVIS_OPTION_IDS = {
  BROUILLON: 'a791d63d-6f62-40ab-8afb-a7b90fea9b6f',
  ENVOYE: '5da0154d-5890-4e30-bd8f-4a7144d52ef3',
  SIGNE: '6dd4abe8-2659-4d7e-bb88-7a352e88fffd',
  REFUSE: '59162c8d-cd1b-4986-85fd-a91336320539',
  REMPLACE: '1c023a80-44df-4e6c-92fa-ca2f26df6215',
} as const;
export const ENCAISSEMENT_OPTION_IDS = {
  AUCUN: 'b5ed3a3c-8661-4500-8c21-bca811a68a8a',
  PARTIEL: 'e4ad726c-ced7-4265-828f-a583ac29965d',
  TOTAL: 'd213815f-1ec5-4b47-96d0-3939c311cfe6',
  NON_VERIFIE: '3794e818-9455-4435-a8a6-7bf6d3b84efc',
} as const;
export const DOSSIER_ON_DEVIS_UNIVERSAL_IDENTIFIER = '2b1ba921-de27-41d0-a940-973ed70aa811';
export const DEVIS_ON_DOSSIER_UNIVERSAL_IDENTIFIER = '8f4e3ed1-b029-4c63-b2c7-b1035efe9ba7';

// Dépendance (15/11/2026) : la tâche `tache` attend la tâche `prerequis`. Plusieurs prérequis possibles.
export const DEPENDANCE_UNIVERSAL_IDENTIFIER = 'e563ec05-ab2c-499e-9fbf-c4122d71c7fe';
export const DEPENDANCE_LIBELLE_FIELD = 'ca5b1cd7-33bc-4bf2-bb24-4e12ee880678';
export const TACHE_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER = '8f7fb4e2-162a-45ca-860a-58fe3685667f';
export const PREREQUIS_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER = '0b1e9517-8f23-4a18-ba52-a1aee80da57e';
export const PREREQUIS_ON_TASK_UNIVERSAL_IDENTIFIER = '351aa2c2-d361-4ea5-a71c-62307c266b79';
export const BLOQUE_ON_TASK_UNIVERSAL_IDENTIFIER = '725dbfb2-0cb0-417f-b010-4a3617aad744';

// Nature d'une tâche (15/11/2026) : le temps de Robert (HUMAIN) ou le travail des agents et des IA (IA).
export const NATURE_ON_TASK_UNIVERSAL_IDENTIFIER = '6a1c2cbe-f341-458d-be08-01d2a3ecbc5b';
export const NATURE_OPTION_IDS = {
  HUMAIN: '26d71f1b-1130-499d-8663-b454343537c4',
  IA: 'f85fa682-625a-4440-9031-a0f4e3ebf3d9',
} as const;
// De quoi préparer un événement d'agenda sans le créer (l'agenda ne se remplit jamais tout seul).
export const BESOIN_AGENDA_ON_TASK_UNIVERSAL_IDENTIFIER = '68ede32a-b4f8-4ce4-9ad9-a7d233f3ab9c';
export const BESOIN_AGENDA_OPTION_IDS = {
  AUCUN: '4380d21b-d991-43c0-9ddf-9b728d221df0',
  RENDEZ_VOUS: 'aad0dd24-396f-4160-af67-4581cae01733',
  APPEL: '331fbb8a-23d4-4180-a7b7-fc0bdac06b74',
} as const;
export const DUREE_ON_TASK_UNIVERSAL_IDENTIFIER = 'fa428673-ce1b-4cdc-b286-4a8da7e308a8';
export const A_CONTACTER_ON_TASK_UNIVERSAL_IDENTIFIER = 'd9cf37b3-a673-4554-8a8e-e27cd95b1c36';
export const TACHES_A_CONTACTER_ON_PERSON_UNIVERSAL_IDENTIFIER = '22498932-8fb5-4dcb-8cf3-43f7dabaabc0';

// Vues natives des tâches (15/11/2026) : « Tâches » (nature HUMAIN) et « Production » (nature IA), chacune en
// tableau et en kanban groupé par importance. Les identifiants des colonnes, filtres, tris et groupes en dérivent
// (`uuidStable`, src/utils/uuid-stable.util.ts) : ne jamais changer ces graines.
export const VUES_TACHES = {
  HUMAIN_TABLEAU: 'e80dab8a-52a6-416d-a631-2ab2fb7ef5e1',
  HUMAIN_KANBAN: '2d798e2b-285f-443e-82a2-79efac32b663',
  IA_TABLEAU: '03dcd1dc-c9e8-4c21-963e-15b4358f7720',
  IA_KANBAN: 'b4e31b69-8f60-440d-8115-ac8a4b66253b',
} as const;
export const TACHES_HUMAIN_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER = 'ed8c7643-2ea1-4b3d-a514-fff3e3076ee2';
export const PRODUCTION_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER = 'f9db27af-56f1-43e9-b2d4-3844a4a67160';

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
