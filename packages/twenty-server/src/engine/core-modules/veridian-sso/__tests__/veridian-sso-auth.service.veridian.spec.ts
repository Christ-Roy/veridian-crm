/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Tests de l'orchestration JIT → loginToken → redirect. Les points d'accroche
 * AGPL (SignInUpService, LoginTokenService, AuthService) sont mockés : on vérifie
 * qu'ils sont appelés avec le provider SSO et le bon workspace, et que l'URL de
 * redirect front est bien retournée.
 */
import { NotFoundException } from '@nestjs/common';

import { type Repository } from 'typeorm';

import { type AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { type SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { type LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { type UserService } from 'src/engine/core-modules/user/services/user.service';
import { VeridianSsoAuthService } from 'src/engine/core-modules/veridian-sso/services/veridian-sso-auth.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

const WORKSPACE = { id: 'ws-1', approvedAccessDomains: [] } as unknown as WorkspaceEntity;

describe('VeridianSsoAuthService (clean-room JIT + loginToken)', () => {
  let service: VeridianSsoAuthService;
  let workspaceRepository: jest.Mocked<Repository<WorkspaceEntity>>;
  let userService: jest.Mocked<UserService>;
  let signInUpService: jest.Mocked<SignInUpService>;
  let loginTokenService: jest.Mocked<LoginTokenService>;
  let authService: jest.Mocked<AuthService>;

  beforeEach(() => {
    workspaceRepository = {
      findOne: jest.fn().mockResolvedValue(WORKSPACE),
    } as unknown as jest.Mocked<Repository<WorkspaceEntity>>;

    userService = {
      findUserByEmail: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    signInUpService = {
      computePartialUserFromUserPayload: jest
        .fn()
        .mockImplementation((payload) =>
          Promise.resolve({
            email: payload.email,
            firstName: payload.firstName ?? '',
            lastName: payload.lastName ?? '',
            isEmailVerified: payload.isEmailAlreadyVerified,
          }),
        ),
      signInUp: jest.fn().mockResolvedValue({
        user: { id: 'u-1', email: 'jane@client.com' },
        workspace: WORKSPACE,
      }),
    } as unknown as jest.Mocked<SignInUpService>;

    loginTokenService = {
      generateLoginToken: jest
        .fn()
        .mockResolvedValue({ token: 'login-token', expiresAt: new Date() }),
    } as unknown as jest.Mocked<LoginTokenService>;

    authService = {
      computeRedirectURI: jest
        .fn()
        .mockReturnValue('https://crm.veridian.site/verify?loginToken=login-token'),
    } as unknown as jest.Mocked<AuthService>;

    service = new VeridianSsoAuthService(
      workspaceRepository,
      userService,
      signInUpService,
      loginTokenService,
      authService,
    );
  });

  it('JIT-provisions a new user and returns the verify redirect URL', async () => {
    userService.findUserByEmail.mockResolvedValue(null);

    const url = await service.completeSignIn(
      { email: 'jane@client.com', firstName: 'Jane', lastName: 'Doe' },
      'ws-1',
    );

    // JIT : nouvel user → payload newUserWithPicture, provider SSO
    expect(signInUpService.signInUp).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: WORKSPACE,
        authParams: { provider: AuthProviderEnum.SSO },
        userData: expect.objectContaining({ type: 'newUserWithPicture' }),
      }),
    );

    // loginToken généré avec le bon workspace et AuthProviderEnum.SSO
    expect(loginTokenService.generateLoginToken).toHaveBeenCalledWith(
      'jane@client.com',
      'ws-1',
      AuthProviderEnum.SSO,
    );

    expect(authService.computeRedirectURI).toHaveBeenCalledWith({
      loginToken: 'login-token',
      workspace: WORKSPACE,
    });
    expect(url).toBe(
      'https://crm.veridian.site/verify?loginToken=login-token',
    );
  });

  it('re-attaches an existing user (existingUser payload)', async () => {
    const existingUser = { id: 'u-9', email: 'bob@client.com' };

    userService.findUserByEmail.mockResolvedValue(existingUser as any);

    await service.completeSignIn({ email: 'bob@client.com' }, 'ws-1');

    expect(signInUpService.signInUp).toHaveBeenCalledWith(
      expect.objectContaining({
        userData: { type: 'existingUser', existingUser },
        authParams: { provider: AuthProviderEnum.SSO },
      }),
    );
  });

  it('throws 404 when the workspace does not exist', async () => {
    workspaceRepository.findOne.mockResolvedValue(null);

    await expect(
      service.completeSignIn({ email: 'x@client.com' }, 'missing-ws'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(signInUpService.signInUp).not.toHaveBeenCalled();
  });
});
