// CONTRAT-HUB §5.19.5: closed registry. Nothing here deletes, nothing here sends an email.
export const DELEGATED_TARGETS = {
  notifuse: {
    scope: 'notifuse:contacts.ecrire',
    actions: {
      'listes.lister': { isIdempotent: false },
      'listes.creer': { isIdempotent: true },
      'contacts.importer': { isIdempotent: true },
    },
  },
  prospection: {
    scope: 'prospection:societe.lire',
    actions: {
      'societes.chercher': { isIdempotent: false },
      'societes.lire': { isIdempotent: false },
    },
  },
  academy: {
    scope: 'academy:avancement.lire',
    actions: { 'avancement.lire': { isIdempotent: false } },
  },
} as const satisfies Record<
  string,
  { scope: string; actions: Record<string, { isIdempotent: boolean }> }
>;

export type DelegatedTarget = keyof typeof DELEGATED_TARGETS;

export const isDelegatedTarget = (value: string): value is DelegatedTarget =>
  Object.keys(DELEGATED_TARGETS).includes(value);

export const findDelegatedAction = (
  target: DelegatedTarget,
  action: string,
): { isIdempotent: boolean } | null => {
  const actions: Record<string, { isIdempotent: boolean }> =
    DELEGATED_TARGETS[target].actions;

  return Object.keys(actions).includes(action) ? actions[action] : null;
};

// The only app whose screens may act: its code is ours, published from the instance catalog.
export const DELEGATING_APP = '1a1ab23e-60e5-4eca-be1f-718c96055c79';
