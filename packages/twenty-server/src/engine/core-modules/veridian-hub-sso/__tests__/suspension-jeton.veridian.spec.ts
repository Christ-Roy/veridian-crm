import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { AuthExceptionCode } from 'src/engine/core-modules/auth/auth.exception';
import { RenewTokenService } from 'src/engine/core-modules/auth/token/services/renew-token.service';

jest.mock('src/engine/core-modules/app-token/app-token.entity', () => ({
  AppTokenEntity: class {},
}));
jest.mock(
  'src/engine/core-modules/auth/token/services/access-token.service',
  () => ({ AccessTokenService: class {} }),
);
jest.mock(
  'src/engine/core-modules/auth/token/services/refresh-token.service',
  () => ({ RefreshTokenService: class {} }),
);
jest.mock(
  'src/engine/core-modules/auth/token/services/workspace-agnostic-token.service',
  () => ({ WorkspaceAgnosticTokenService: class {} }),
);
jest.mock(
  'src/engine/core-entity-cache/services/core-entity-cache.service',
  () => ({ CoreEntityCacheService: class {} }),
);

// CONTRAT-HUB §5.4 : le rafraîchissement (60 jours) d'un espace suspendu est refusé avant d'être consommé.
const construire = (activationStatus: WorkspaceActivationStatus | null) => {
  const transaction = jest.fn().mockRejectedValue(new Error('consommé'));
  const service = new (RenewTokenService as never as new (
    ...args: unknown[]
  ) => RenewTokenService)(
    { manager: { transaction } },
    {},
    {},
    {
      verifyRefreshToken: jest.fn().mockResolvedValue({
        user: { id: 'u' },
        token: { id: 't', workspaceId: activationStatus ? 'ws' : null },
      }),
    },
    { get: jest.fn(async () => ({ activationStatus, deletedAt: null })) },
  );

  return { service, transaction };
};

describe('suspension Veridian : rafraîchissement de session', () => {
  it('espace suspendu : refusé, le jeton reste entier pour la reprise', async () => {
    const { service, transaction } = construire(
      WorkspaceActivationStatus.SUSPENDED,
    );

    await expect(
      service.generateTokensFromRefreshToken('jeton'),
    ).rejects.toMatchObject({ code: AuthExceptionCode.WORKSPACE_SUSPENDED });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['actif', WorkspaceActivationStatus.ACTIVE],
    ['sans espace', null],
  ])('%s : le renouvellement suit son cours', async (_, statut) => {
    const { service, transaction } = construire(statut);

    await expect(
      service.generateTokensFromRefreshToken('jeton'),
    ).rejects.toThrow('consommé');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
