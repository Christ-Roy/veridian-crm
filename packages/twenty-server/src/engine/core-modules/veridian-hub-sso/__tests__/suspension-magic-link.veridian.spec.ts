import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { isMagicLinkRefusedForSuspension } from 'src/engine/core-modules/veridian-hub-sso/utils/is-magic-link-refused-for-suspension.util';

const S = WorkspaceActivationStatus.SUSPENDED;
const A = WorkspaceActivationStatus.ACTIVE;
const C = WorkspaceActivationStatus.CREATED;

// CONTRAT-HUB §5.21 : 423 workspace_suspended seulement si l'espace demandé, ou tous les espaces, sont suspendus.
describe('issue-magic-link et espace suspendu (423)', () => {
  it('membre d un espace actif : entre dans l actif', () => {
    expect(
      isMagicLinkRefusedForSuspension(
        [
          { subdomain: 'a', activationStatus: A },
          { subdomain: 'b', activationStatus: S },
        ],
        'a',
      ),
    ).toBe(false);
  });

  it('espace demandé suspendu alors qu un autre est actif : 423', () => {
    expect(
      isMagicLinkRefusedForSuspension(
        [
          { subdomain: 'a', activationStatus: A },
          { subdomain: 'b', activationStatus: S },
        ],
        'b',
      ),
    ).toBe(true);
  });

  it('tous les espaces suspendus : 423', () => {
    expect(
      isMagicLinkRefusedForSuspension(
        [
          { subdomain: 'a', activationStatus: S },
          { subdomain: 'b', activationStatus: S },
        ],
        null,
      ),
    ).toBe(true);
  });

  it('espace créé (non suspendu) sans espace actif : pas de 423', () => {
    expect(
      isMagicLinkRefusedForSuspension(
        [{ subdomain: 'a', activationStatus: C }],
        null,
      ),
    ).toBe(false);
  });

  it('aucun espace : pas de 423', () => {
    expect(isMagicLinkRefusedForSuspension([], 'a')).toBe(false);
  });
});
