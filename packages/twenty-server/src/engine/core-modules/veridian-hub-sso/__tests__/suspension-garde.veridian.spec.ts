import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { ClosedWhenSuspendedGuard } from 'src/engine/core-modules/veridian-hub-sso/guards/closed-when-suspended.guard';
import { WorkspaceNotSuspendedGuard } from 'src/engine/guards/workspace-not-suspended.guard';

jest.mock('src/utils/extract-request', () => ({
  getRequest: (context: { __request: unknown }) => context.__request,
}));

class MessageChannelResolver {
  myMessageChannels() {}
}

class FrontComponentController {
  serve() {}
}

class AuthResolver {
  signIn() {}
}

class WorkspaceResolver {
  deleteCurrentWorkspace() {}
}

class CoreResolver {
  objects() {}
  currentUser() {}
  notDecorated() {}
}

const SUSPENDED = {
  activationStatus: WorkspaceActivationStatus.SUSPENDED,
  deletedAt: null,
};
const ACTIVE = {
  activationStatus: WorkspaceActivationStatus.ACTIVE,
  deletedAt: null,
};

const context = (
  owner: new () => object,
  method: string,
  workspace: unknown,
) => {
  const handler = (owner.prototype as Record<string, () => void>)[method];

  return {
    __request: { workspace },
    getClass: () => owner,
    getHandler: () => handler,
  } as never;
};

// Le décorateur est lu ici comme posé : toute méthode listée ci-dessous est « ouverte » par la garde amont.
const decorated = new Set<string>([
  'MessageChannelResolver.myMessageChannels',
  'FrontComponentController.serve',
  'CoreResolver.objects',
  'CoreResolver.currentUser',
  'AuthResolver.signIn',
  'WorkspaceResolver.deleteCurrentWorkspace',
]);

const buildGuard = () => {
  const reflector = {
    getAllAndOverride: jest.fn(
      (_key: unknown, [handler, owner]: [{ name: string }, { name: string }]) =>
        decorated.has(`${owner.name}.${handler.name}`),
    ),
  };

  const nativeGuard = new WorkspaceNotSuspendedGuard(reflector as never);
  const closedGuard = new ClosedWhenSuspendedGuard();

  return {
    nativeGuard,
    canActivate: (executionContext: never) =>
      nativeGuard.canActivate(executionContext) &&
      closedGuard.canActivate(executionContext),
  };
};

describe('garde d espace suspendu (Veridian, CONTRAT-HUB §5.4)', () => {
  it('refuse une méthode amont décorée mais fermée par Veridian (suspendu)', () => {
    const guard = buildGuard();

    expect(() =>
      guard.canActivate(
        context(MessageChannelResolver, 'myMessageChannels', SUSPENDED),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(context(FrontComponentController, 'serve', SUSPENDED)),
    ).toThrow();
    expect(() =>
      guard.canActivate(context(AuthResolver, 'signIn', SUSPENDED)),
    ).toThrow();
    expect(() =>
      guard.canActivate(
        context(WorkspaceResolver, 'deleteCurrentWorkspace', SUSPENDED),
      ),
    ).toThrow();
  });

  it('c est bien notre garde qui ferme : la garde amont seule laisse passer', () => {
    const { nativeGuard } = buildGuard();

    expect(
      nativeGuard.canActivate(
        context(MessageChannelResolver, 'myMessageChannels', SUSPENDED),
      ),
    ).toBe(true);
  });

  it('laisse passer une méthode décorée et non fermée (écran : métadonnées, session)', () => {
    const guard = buildGuard();

    expect(guard.canActivate(context(CoreResolver, 'objects', SUSPENDED))).toBe(
      true,
    );
    expect(
      guard.canActivate(context(CoreResolver, 'currentUser', SUSPENDED)),
    ).toBe(true);
  });

  it('refuse une méthode non décorée (suspendu)', () => {
    const guard = buildGuard();

    expect(() =>
      guard.canActivate(context(CoreResolver, 'notDecorated', SUSPENDED)),
    ).toThrow();
  });

  it('espace actif : rien n est refusé, classement compris', () => {
    const guard = buildGuard();

    expect(
      guard.canActivate(
        context(MessageChannelResolver, 'myMessageChannels', ACTIVE),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(context(FrontComponentController, 'serve', ACTIVE)),
    ).toBe(true);
    expect(
      guard.canActivate(
        context(WorkspaceResolver, 'deleteCurrentWorkspace', ACTIVE),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(context(CoreResolver, 'notDecorated', ACTIVE)),
    ).toBe(true);
  });
});
