/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Tests du service OIDC : openid-client mocké, aucun appel réseau réel.
 */
import { BadRequestException } from '@nestjs/common';

import { VeridianOidcService } from 'src/engine/core-modules/veridian-sso/services/veridian-oidc.service';
import { type VeridianOidcConfig } from 'src/engine/core-modules/veridian-sso/types/veridian-sso-config.type';

const authorizationUrl = jest.fn();
const callback = jest.fn();
const userinfo = jest.fn();
const ClientMock = jest.fn().mockImplementation(() => ({
  authorizationUrl,
  callback,
  userinfo,
}));

jest.mock('openid-client', () => ({
  Issuer: {
    discover: jest.fn().mockResolvedValue({ Client: ClientMock }),
  },
}));

const CONFIG: VeridianOidcConfig = {
  issuerUrl: 'https://idp.example.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

const REDIRECT_URI = 'https://crm.veridian.site/auth/sso/p1/callback';

describe('VeridianOidcService (clean-room OIDC)', () => {
  let service: VeridianOidcService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VeridianOidcService();
  });

  describe('getAuthorizationUrl', () => {
    it('builds the authorization URL with state, nonce and scope', async () => {
      authorizationUrl.mockReturnValue(
        'https://idp.example.com/authorize?state=s&nonce=n',
      );

      const url = await service.getAuthorizationUrl(
        CONFIG,
        REDIRECT_URI,
        'state-123',
        'nonce-456',
      );

      expect(url).toBe('https://idp.example.com/authorize?state=s&nonce=n');
      expect(ClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: CONFIG.clientId,
          client_secret: CONFIG.clientSecret,
          redirect_uris: [REDIRECT_URI],
          response_types: ['code'],
        }),
      );
      expect(authorizationUrl).toHaveBeenCalledWith({
        scope: 'openid email profile',
        state: 'state-123',
        nonce: 'nonce-456',
      });
    });
  });

  describe('handleCallback', () => {
    it('extracts an identity from id_token claims', async () => {
      callback.mockResolvedValue({
        access_token: 'at',
        claims: () => ({
          sub: '123',
          email: 'Jane@Client.com',
          given_name: 'Jane',
          family_name: 'Doe',
        }),
      });

      const identity = await service.handleCallback(
        CONFIG,
        REDIRECT_URI,
        { code: 'auth-code', state: 'state-123' },
        { state: 'state-123', nonce: 'nonce-456' },
      );

      expect(identity).toEqual({
        email: 'jane@client.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      expect(callback).toHaveBeenCalledWith(
        REDIRECT_URI,
        { code: 'auth-code', state: 'state-123' },
        { state: 'state-123', nonce: 'nonce-456' },
      );
      // email présent dans les claims → pas d'appel userinfo
      expect(userinfo).not.toHaveBeenCalled();
    });

    it('falls back to userinfo when the id_token has no email', async () => {
      callback.mockResolvedValue({
        access_token: 'access-token',
        claims: () => ({ sub: '123' }),
      });
      userinfo.mockResolvedValue({
        email: 'fromuserinfo@client.com',
        given_name: 'Info',
      });

      const identity = await service.handleCallback(
        CONFIG,
        REDIRECT_URI,
        { code: 'c', state: 'state-123' },
        { state: 'state-123', nonce: 'nonce-456' },
      );

      expect(userinfo).toHaveBeenCalledWith('access-token');
      expect(identity.email).toBe('fromuserinfo@client.com');
      expect(identity.firstName).toBe('Info');
    });

    it('honours custom claim mappings', async () => {
      callback.mockResolvedValue({
        access_token: 'at',
        claims: () => ({
          upn: 'mapped@client.com',
          first: 'Mapped',
          last: 'User',
        }),
      });

      const identity = await service.handleCallback(
        {
          ...CONFIG,
          emailClaim: 'upn',
          firstNameClaim: 'first',
          lastNameClaim: 'last',
        },
        REDIRECT_URI,
        { code: 'c' },
        { state: 's', nonce: 'n' },
      );

      expect(identity).toEqual({
        email: 'mapped@client.com',
        firstName: 'Mapped',
        lastName: 'User',
      });
    });

    it('rejects when no email is resolvable', async () => {
      callback.mockResolvedValue({
        access_token: undefined,
        claims: () => ({ sub: '123' }),
      });

      await expect(
        service.handleCallback(
          CONFIG,
          REDIRECT_URI,
          { code: 'c' },
          { state: 's', nonce: 'n' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the token exchange fails (replay / bad state)', async () => {
      callback.mockRejectedValue(new Error('nonce mismatch'));

      await expect(
        service.handleCallback(
          CONFIG,
          REDIRECT_URI,
          { code: 'c' },
          { state: 's', nonce: 'n' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
