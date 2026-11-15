// Les trois grandes catégories de dossiers, dans l'ordre d'affichage (Robert, 15/11/2026 : client, interne,
// prospection). Obligatoire sur un dossier ; seule celle du dossier racine compte, ses sous-dossiers en héritent.
export const CATEGORIES = ['CLIENT', 'INTERNE', 'PROSPECTION'] as const;
export type Categorie = (typeof CATEGORIES)[number];

export const LIBELLES_CATEGORIE: Record<Categorie, string> = {
  CLIENT: 'Client',
  INTERNE: 'Interne',
  PROSPECTION: 'Prospection',
};

const COULEURS = { CLIENT: 'green', INTERNE: 'purple', PROSPECTION: 'orange' } as const;

export const optionsCategorie = (ids: Record<Categorie, string>) =>
  CATEGORIES.map((value, position) => ({
    id: ids[value],
    value,
    label: LIBELLES_CATEGORIE[value],
    position,
    color: COULEURS[value],
  }));

// Une valeur inconnue ou vide range le dossier dans « Interne » : rien ne disparaît de la vue.
export const categorieDe = (valeur: string | null | undefined): Categorie =>
  (CATEGORIES as readonly string[]).includes(valeur ?? '') ? (valeur as Categorie) : 'INTERNE';

// Clic sur la pastille de catégorie d'un dossier racine : catégorie suivante, en boucle.
export const categorieSuivante = (valeur: string | null | undefined): Categorie =>
  CATEGORIES[(CATEGORIES.indexOf(categorieDe(valeur)) + 1) % CATEGORIES.length];
