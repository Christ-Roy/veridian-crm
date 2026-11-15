// Nature d'une tâche (Robert, 15/11/2026) : distinguer son temps réel du travail exécuté par les agents.
// HUMAIN (« Robert ») : rendez-vous client, appels pour débloquer un jalon, décisions, gestes physiques.
// IA (« Production ») : exécuté par des agents ou des IA. Valeurs figées dans le code, jamais éditées dans l'UI.
export const NATURES = ['HUMAIN', 'IA'] as const;
export type Nature = (typeof NATURES)[number];

export const LIBELLES_NATURE: Record<Nature, string> = { HUMAIN: 'Robert', IA: 'Production' };

export const optionsNature = (ids: Record<Nature, string>) =>
  NATURES.map((value, position) => ({
    id: ids[value],
    value,
    label: LIBELLES_NATURE[value],
    position,
    color: (value === 'HUMAIN' ? 'turquoise' : 'purple') as 'turquoise' | 'purple',
  }));

export const natureSuivante = (valeur: string | null | undefined): Nature => (valeur === 'HUMAIN' ? 'IA' : 'HUMAIN');

// Besoin d'événement d'agenda : préparé ici, jamais créé tout seul.
export const BESOINS_AGENDA = ['AUCUN', 'RENDEZ_VOUS', 'APPEL'] as const;
export type BesoinAgenda = (typeof BESOINS_AGENDA)[number];
export const LIBELLES_BESOIN_AGENDA: Record<BesoinAgenda, string> = { AUCUN: 'Aucun', RENDEZ_VOUS: 'Rendez-vous', APPEL: 'Appel' };
