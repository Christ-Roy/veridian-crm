type DelegatedAction = { scope: string; isIdempotent: boolean };

// CONTRAT-HUB §5.19.5: closed registry, one scope per action. Nothing here deletes. `sequences.inscrire` alone lets mail
// leave, later and by the rules of the sequence, hence its own scope.
export const DELEGATED_TARGETS = {
  notifuse: {
    'listes.lister': {
      scope: 'notifuse:contacts.ecrire',
      isIdempotent: false,
    },
    'listes.creer': { scope: 'notifuse:contacts.ecrire', isIdempotent: true },
    'contacts.importer': {
      scope: 'notifuse:contacts.ecrire',
      isIdempotent: true,
    },
    'sequences.lister': {
      scope: 'notifuse:contacts.ecrire',
      isIdempotent: false,
    },
    'sequences.inscrire': {
      scope: 'notifuse:sequences.inscrire',
      isIdempotent: true,
    },
  },
  prospection: {
    'entreprises.chercher': {
      scope: 'prospection:entreprise.lire',
      isIdempotent: false,
    },
    'entreprises.enrichir': {
      scope: 'prospection:entreprise.lire',
      isIdempotent: true,
    },
  },
  academy: {
    'avancement.lire': {
      scope: 'academy:avancement.lire',
      isIdempotent: false,
    },
  },
} as const satisfies Record<string, Record<string, DelegatedAction>>;

export type DelegatedTarget = keyof typeof DELEGATED_TARGETS;

export const isDelegatedTarget = (value: string): value is DelegatedTarget =>
  Object.keys(DELEGATED_TARGETS).includes(value);

export const findDelegatedAction = (
  target: DelegatedTarget,
  action: string,
): DelegatedAction | null => {
  const actions: Record<string, DelegatedAction> = DELEGATED_TARGETS[target];

  return Object.keys(actions).includes(action) ? actions[action] : null;
};

// The only app whose screens may act: its code is ours, published from the instance catalog.
export const DELEGATING_APP = '1a1ab23e-60e5-4eca-be1f-718c96055c79';
