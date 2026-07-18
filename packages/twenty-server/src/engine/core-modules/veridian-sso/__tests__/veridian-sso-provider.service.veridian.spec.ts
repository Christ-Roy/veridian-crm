/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Tests du provider service : chiffrement de la config (SecretEncryptionService
 * mocké), CRUD, gardes isEnabled / type / workspaceId.
 */
import { NotFoundException } from '@nestjs/common';

import { type Repository } from 'typeorm';

import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { VeridianSsoProviderEntity } from 'src/engine/core-modules/veridian-sso/entities/veridian-sso-provider.entity';
import { VeridianSsoProviderType } from 'src/engine/core-modules/veridian-sso/enums/veridian-sso-provider-type.enum';
import { VeridianSsoProviderService } from 'src/engine/core-modules/veridian-sso/services/veridian-sso-provider.service';

describe('VeridianSsoProviderService (clean-room)', () => {
  let service: VeridianSsoProviderService;
  let repository: jest.Mocked<Repository<VeridianSsoProviderEntity>>;
  let secretEncryption: jest.Mocked<SecretEncryptionService>;

  beforeEach(() => {
    repository = {
      create: jest.fn((v) => v as VeridianSsoProviderEntity),
      save: jest.fn((v) => Promise.resolve(v as VeridianSsoProviderEntity)),
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<VeridianSsoProviderEntity>>;

    secretEncryption = {
      // Round-trip simulé : préfixe enc: pour vérifier que la config n'est
      // jamais persistée en clair.
      encryptVersioned: jest.fn((value: string) => `enc:${value}`),
      // Upstream (sync 2026-07-18) a renommé `decryptVersioned` →
      // `decryptVersionedOrThrow` sur SecretEncryptionService (chemin runtime).
      decryptVersionedOrThrow: jest.fn((value: string) =>
        value.replace(/^enc:/, ''),
      ),
    } as unknown as jest.Mocked<SecretEncryptionService>;

    service = new VeridianSsoProviderService(repository, secretEncryption);
  });

  it('encrypts the IdP config before persisting (never plaintext)', async () => {
    const config = {
      entryPoint: 'https://idp/sso',
      idpCert: 'CERT',
      issuer: 'veridian',
    };

    await service.create({
      workspaceId: 'ws-1',
      type: VeridianSsoProviderType.SAML,
      name: 'Okta',
      config,
    });

    const saved = repository.save.mock.calls[0][0] as VeridianSsoProviderEntity;

    expect(secretEncryption.encryptVersioned).toHaveBeenCalledWith(
      JSON.stringify(config),
      { workspaceId: 'ws-1' },
    );
    // La valeur persistée est le ciphertext (préfixe enc:), pas le JSON brut.
    expect(saved.encryptedConfig).toBe(`enc:${JSON.stringify(config)}`);
    expect(saved.encryptedConfig.startsWith('enc:')).toBe(true);
    expect(saved.isEnabled).toBe(true);
  });

  it('round-trips the OIDC config through decryptVersionedOrThrow', async () => {
    const config = {
      issuerUrl: 'https://idp',
      clientId: 'cid',
      clientSecret: 'secret',
    };
    const provider = {
      workspaceId: 'ws-1',
      type: VeridianSsoProviderType.OIDC,
      encryptedConfig: `enc:${JSON.stringify(config)}`,
    } as VeridianSsoProviderEntity;

    const decrypted = service.getDecryptedOidcConfig(provider);

    expect(secretEncryption.decryptVersionedOrThrow).toHaveBeenCalledWith(
      provider.encryptedConfig,
      { workspaceId: 'ws-1' },
    );
    expect(decrypted).toEqual(config);
  });

  it('findEnabledByIdOrThrow returns an enabled provider', async () => {
    const provider = { id: 'p1', isEnabled: true } as VeridianSsoProviderEntity;

    repository.findOne.mockResolvedValue(provider);

    await expect(service.findEnabledByIdOrThrow('p1')).resolves.toBe(provider);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'p1', isEnabled: true },
    });
  });

  it('findEnabledByIdOrThrow throws 404 for unknown / disabled provider', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.findEnabledByIdOrThrow('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a SAML decode on an OIDC provider (type guard)', () => {
    const provider = {
      workspaceId: 'ws-1',
      type: VeridianSsoProviderType.OIDC,
      encryptedConfig: 'enc:{}',
    } as VeridianSsoProviderEntity;

    expect(() => service.getDecryptedSamlConfig(provider)).toThrow(
      NotFoundException,
    );
  });
});
