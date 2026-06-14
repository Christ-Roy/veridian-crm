/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Tests du service SAML : node-saml mocké, aucun appel réseau réel.
 */
import { BadRequestException } from '@nestjs/common';

import { SAML } from '@node-saml/node-saml';

import { VeridianSamlService } from 'src/engine/core-modules/veridian-sso/services/veridian-saml.service';
import { type VeridianSamlConfig } from 'src/engine/core-modules/veridian-sso/types/veridian-sso-config.type';

jest.mock('@node-saml/node-saml', () => {
  const getAuthorizeUrlAsync = jest.fn();
  const validatePostResponseAsync = jest.fn();

  return {
    SAML: jest.fn().mockImplementation(() => ({
      getAuthorizeUrlAsync,
      validatePostResponseAsync,
    })),
    __mocks: { getAuthorizeUrlAsync, validatePostResponseAsync },
  };
});

const samlMocks = (jest.requireMock('@node-saml/node-saml') as any).__mocks;

const CONFIG: VeridianSamlConfig = {
  entryPoint: 'https://idp.example.com/sso',
  idpCert: 'FAKECERT',
  issuer: 'veridian-crm',
};

const CALLBACK_URL = 'https://crm.veridian.site/auth/sso/p1/acs';

describe('VeridianSamlService (clean-room SAML 2.0)', () => {
  let service: VeridianSamlService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VeridianSamlService();
  });

  describe('getLoginUrl', () => {
    it('builds the IdP login URL via node-saml', async () => {
      samlMocks.getAuthorizeUrlAsync.mockResolvedValue(
        'https://idp.example.com/sso?SAMLRequest=abc',
      );

      const url = await service.getLoginUrl(CONFIG, CALLBACK_URL, 'p1');

      expect(url).toBe('https://idp.example.com/sso?SAMLRequest=abc');
      expect(SAML).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: CALLBACK_URL,
          entryPoint: CONFIG.entryPoint,
          idpCert: CONFIG.idpCert,
          issuer: CONFIG.issuer,
          wantAuthnResponseSigned: true,
          wantAssertionsSigned: true,
        }),
      );
      expect(samlMocks.getAuthorizeUrlAsync).toHaveBeenCalledWith('p1', '', {});
    });
  });

  describe('validateResponse', () => {
    it('extracts a normalized identity from a valid SAML profile', async () => {
      samlMocks.validatePostResponseAsync.mockResolvedValue({
        profile: {
          nameID: 'jane@client.com',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        loggedOut: false,
      });

      const identity = await service.validateResponse(
        CONFIG,
        CALLBACK_URL,
        'base64-saml-response',
      );

      expect(identity).toEqual({
        email: 'jane@client.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });
    });

    it('lowercases the email coming from the IdP', async () => {
      samlMocks.validatePostResponseAsync.mockResolvedValue({
        profile: { email: 'John.SMITH@Client.COM' },
        loggedOut: false,
      });

      const identity = await service.validateResponse(
        CONFIG,
        CALLBACK_URL,
        'resp',
      );

      expect(identity.email).toBe('john.smith@client.com');
    });

    it('honours custom attribute mappings', async () => {
      samlMocks.validatePostResponseAsync.mockResolvedValue({
        profile: {
          mail: 'mapped@client.com',
          gn: 'Mapped',
          sn: 'User',
        },
        loggedOut: false,
      });

      const identity = await service.validateResponse(
        {
          ...CONFIG,
          emailAttribute: 'mail',
          firstNameAttribute: 'gn',
          lastNameAttribute: 'sn',
        },
        CALLBACK_URL,
        'resp',
      );

      expect(identity).toEqual({
        email: 'mapped@client.com',
        firstName: 'Mapped',
        lastName: 'User',
      });
    });

    it('rejects a response without an email', async () => {
      samlMocks.validatePostResponseAsync.mockResolvedValue({
        profile: { firstName: 'NoEmail' },
        loggedOut: false,
      });

      await expect(
        service.validateResponse(CONFIG, CALLBACK_URL, 'resp'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when node-saml throws (invalid signature)', async () => {
      samlMocks.validatePostResponseAsync.mockRejectedValue(
        new Error('Invalid signature'),
      );

      await expect(
        service.validateResponse(CONFIG, CALLBACK_URL, 'tampered'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when no profile is returned', async () => {
      samlMocks.validatePostResponseAsync.mockResolvedValue({
        profile: null,
        loggedOut: false,
      });

      await expect(
        service.validateResponse(CONFIG, CALLBACK_URL, 'resp'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
