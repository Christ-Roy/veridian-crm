import { FeatureFlagKey } from 'twenty-shared/types';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import {
  VERIDIAN_KEPT_OFF_FEATURE_FLAGS,
  VERIDIAN_NATIVE_FEATURE_FLAGS,
} from 'src/engine/core-modules/veridian-hub-sso/constants/veridian-native-feature-flags.constant';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';

// Veridian (27/11/2026) : un espace neuf naît avec les fonctions natives allumées, par le chemin de provisioning du Hub.
jest.mock('src/engine/core-modules/application/application-install/services/application-lifecycle-job.service', () => ({
  ApplicationLifecycleJobService: class ApplicationLifecycleJobService {},
}));
jest.mock('src/engine/core-modules/veridian-hub-sso/services/veridian-hub-member-access.service', () => ({
  VeridianHubMemberAccessService: class {},
}));
jest.mock('src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service', () => ({
  VeridianHubRoleService: class VeridianHubRoleService {},
}));
jest.mock('src/engine/core-modules/auth/services/sign-in-up.service', () => ({
  SignInUpService: class SignInUpService {},
}));
jest.mock('src/engine/core-modules/auth/token/services/login-token.service', () => ({
  LoginTokenService: class LoginTokenService {},
}));
jest.mock('src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service', () => ({
  WorkspaceDomainsService: class WorkspaceDomainsService {},
}));
jest.mock('src/engine/core-modules/onboarding/onboarding.service', () => ({
  OnboardingService: class OnboardingService {},
}));
jest.mock('src/engine/core-modules/throttler/throttler.service', () => ({
  ThrottlerService: class ThrottlerService {},
}));
jest.mock('src/engine/core-modules/twenty-config/twenty-config.service', () => ({
  TwentyConfigService: class TwentyConfigService {},
}));
jest.mock('src/engine/core-modules/user-session/services/user-session.service', () => ({
  UserSessionService: class UserSessionService {},
}));
jest.mock('src/engine/core-modules/user-workspace/user-workspace.entity', () => ({
  UserWorkspaceEntity: class UserWorkspaceEntity {},
}));
jest.mock('src/engine/core-modules/user-workspace/user-workspace.service', () => ({
  UserWorkspaceService: class UserWorkspaceService {},
}));
jest.mock('src/engine/core-modules/user/services/user.service', () => ({
  UserService: class UserService {},
}));
jest.mock('src/engine/core-modules/user/user.entity', () => ({
  UserEntity: class UserEntity {},
}));
jest.mock('src/engine/core-modules/workspace/services/workspace.service', () => ({
  WorkspaceService: class WorkspaceService {},
}));
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class WorkspaceEntity {},
}));
jest.mock('src/engine/core-modules/cache-storage/services/cache-storage.service', () => ({
  CacheStorageService: class CacheStorageService {},
}));
jest.mock('src/engine/core-modules/key-value-pair/key-value-pair.entity', () => ({
  KeyValuePairEntity: class KeyValuePairEntity {},
  KeyValuePairType: { USER_VARIABLE: 'USER_VARIABLE' },
}));
jest.mock('src/engine/core-entity-cache/services/core-entity-cache.service', () => ({
  CoreEntityCacheService: class CoreEntityCacheService {},
}));
jest.mock('src/engine/workspace-cache/services/workspace-cache.service', () => ({
  WorkspaceCacheService: class WorkspaceCacheService {},
}));
jest.mock('src/engine/twenty-orm/workspace-orm.manager', () => ({
  WorkspaceOrmManager: class WorkspaceOrmManager {},
}));
jest.mock('src/engine/twenty-orm/utils/build-system-auth-context.util', () => ({
  buildSystemAuthContext: () => ({}),
}));
jest.mock('src/engine/guards/no-permission.guard', () => ({
  NoPermissionGuard: class NoPermissionGuard {},
}));
jest.mock('src/engine/guards/public-endpoint.guard', () => ({
  PublicEndpointGuard: class PublicEndpointGuard {},
}));
jest.mock('src/engine/core-modules/feature-flag/services/feature-flag.service', () => ({
  FeatureFlagService: class FeatureFlagService {},
}));
jest.mock('src/engine/core-modules/veridian-hub-sso/services/veridian-hub-organisation.service', () => ({
  VeridianHubOrganisationService: class {},
}));
jest.mock('src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service', () => ({
  VeridianHubSuspensionService: class {},
}));

const HUB_USER = '11111111-1111-4111-8111-111111111111';
const TENANT = '44444444-4444-4444-8444-444444444444';
const WS = '55555555-5555-4555-8555-555555555555';

const creer = ({ flagsEchouent = false } = {}) => {
  const enableFeatureFlags = jest.fn(async () => {
    if (flagsEchouent) {
      throw new Error('panne');
    }
  });
  const activateWorkspace = jest.fn(async () => true);
  const user = {
    id: 'u1',
    email: 'proprio@exemple.fr',
    canAccessFullAdminPanel: false,
    canImpersonate: false,
    createdAt: new Date('2026-11-27T00:00:00Z'),
    updatedAt: new Date('2026-11-27T00:00:00Z'),
    deletedAt: null,
  };
  const featureFlagService = { enableFeatureFlags };
  const service = new (VeridianHubSsoService as never as new (
    ...args: unknown[]
  ) => VeridianHubSsoService)(
    { findOne: jest.fn(async () => null), find: jest.fn(async () => []), query: jest.fn(async () => []) },
    { findOne: jest.fn(async () => null), find: jest.fn(async () => []) },
    { find: jest.fn(async () => []), findOne: jest.fn(async () => null), update: jest.fn(async () => ({})) },
    { findOne: jest.fn(async () => null), save: jest.fn(async () => ({})), query: jest.fn(async () => []) },
    { setIfAbsent: jest.fn(async () => true), del: jest.fn(async () => undefined) },
    { generateLoginToken: jest.fn(async () => ({ token: 't' })) },
    {},
    {},
    { get: jest.fn(() => 'https://crm.exemple.fr') },
    {
      signUpOnNewWorkspace: jest.fn(async () => ({ user, workspace: { id: WS } })),
    },
    { activateWorkspace },
    {
      setOnboardingCreateProfilePending: jest.fn(),
      setOnboardingConnectAccountPending: jest.fn(),
      setOnboardingInviteTeamPending: jest.fn(),
      setOnboardingBookCallPending: jest.fn(),
    },
    {},
    {},
    { invalidate: jest.fn(async () => undefined) },
    {},
    {},
    { invalidate: jest.fn(async () => undefined) },
    {},
    {},
    { triggerInstallApplication: jest.fn(async () => undefined) },
    featureFlagService,
  );

  return {
    enableFeatureFlags,
    activateWorkspace,
    provision: () =>
      (service as unknown as {
        provisionTenant: (args: Record<string, unknown>) => Promise<unknown>;
      }).provisionTenant({
        tenantId: TENANT,
        ownerEmail: 'proprio@exemple.fr',
        workspaceName: 'Cabinet',
        hubUserId: HUB_USER,
        plan: 'free',
        emailProven: true,
      }),
  };
};

describe('naissance : fonctions natives allumées à la création d un espace', () => {
  it('pose la liste native sur le nouvel espace, après son activation', async () => {
    const m = creer();

    await expect(m.provision()).resolves.toMatchObject({ status: 'ok', created: true, workspaceId: WS });
    expect(m.enableFeatureFlags).toHaveBeenCalledWith([...VERIDIAN_NATIVE_FEATURE_FLAGS], WS);
    expect(m.enableFeatureFlags.mock.invocationCallOrder[0]).toBeGreaterThan(
      m.activateWorkspace.mock.invocationCallOrder[0],
    );
  });

  it('la liste native est celle décidée (un ajout ou un retrait se voit ici)', () => {
    expect([...VERIDIAN_NATIVE_FEATURE_FLAGS].sort()).toEqual(
      [
        FeatureFlagKey.IS_APP_PREFERENCES_ENABLED,
        FeatureFlagKey.IS_CALENDAR_EVENT_SHARED_ACROSS_CHANNELS_ENABLED,
        FeatureFlagKey.IS_CONFIGURABLE_SEARCH_FIELDS_ENABLED,
        FeatureFlagKey.IS_GETTING_STARTED_ENABLED,
      ].sort(),
    );
  });

  it('aucune sortie vers un tiers, aucune IA, aucun code Enterprise n est allumé à la naissance', () => {
    const interdits = Object.keys(VERIDIAN_KEPT_OFF_FEATURE_FLAGS);

    expect(interdits).toEqual(
      expect.arrayContaining([
        FeatureFlagKey.IS_AI_CHAT_INBOX_ENABLED,
        FeatureFlagKey.IS_AI_CHAT_COMPONENT_BUILDER_ENABLED,
        FeatureFlagKey.IS_MCP_SERVERS_ENABLED,
        FeatureFlagKey.IS_RECORD_LEVEL_SHARING_ENABLED,
        FeatureFlagKey.IS_RELATED_RECORD_PATHS_ENABLED,
        FeatureFlagKey.IS_ROW_LEVEL_PERMISSION_RELATION_HOP_ENABLED,
      ]),
    );
    for (const cle of interdits) {
      expect(VERIDIAN_NATIVE_FEATURE_FLAGS).not.toContain(cle);
    }
  });

  it('un échec des drapeaux est journalisé sans bloquer la création', async () => {
    const m = creer({ flagsEchouent: true });

    await expect(m.provision()).resolves.toMatchObject({ status: 'ok', created: true });
  });
});
