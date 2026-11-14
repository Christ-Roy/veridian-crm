// Niveaux d'importance, communs aux dossiers et aux tâches. Obligatoires : NORMALE par défaut.
export const IMPORTANCES = ['CRITIQUE', 'HAUTE', 'NORMALE', 'BASSE'] as const;
export type Importance = (typeof IMPORTANCES)[number];

export const LIBELLES_IMPORTANCE: Record<Importance, string> = {
  CRITIQUE: 'Critique',
  HAUTE: 'Haute',
  NORMALE: 'Normale',
  BASSE: 'Basse',
};

const COULEURS = { CRITIQUE: 'red', HAUTE: 'orange', NORMALE: 'blue', BASSE: 'gray' } as const;

export const optionsImportance = (ids: Record<Importance, string>) =>
  IMPORTANCES.map((value, position) => ({
    id: ids[value],
    value,
    label: LIBELLES_IMPORTANCE[value],
    position,
    color: COULEURS[value],
  }));

export const rangImportance = (valeur: string | null | undefined): number => {
  const i = IMPORTANCES.indexOf((valeur ?? 'NORMALE') as Importance);
  return i === -1 ? 2 : i;
};

// Clic sur la pastille : on monte d'un cran ; de Critique on retombe à Basse.
export const importanceSuivante = (valeur: string | null | undefined): Importance =>
  IMPORTANCES[(rangImportance(valeur) + IMPORTANCES.length - 1) % IMPORTANCES.length];
