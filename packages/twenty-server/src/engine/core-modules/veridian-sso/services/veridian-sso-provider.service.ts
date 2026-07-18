/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * CRUD des fournisseurs SSO + (dé)chiffrement de la config IdP.
 * La config en clair ne transite jamais en base : elle est chiffrée via le
 * SecretEncryptionService natif de Twenty (AES-256-GCM, AAD = workspaceId).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { type PlaintextString } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { VeridianSsoProviderEntity } from 'src/engine/core-modules/veridian-sso/entities/veridian-sso-provider.entity';
import { VeridianSsoProviderType } from 'src/engine/core-modules/veridian-sso/enums/veridian-sso-provider-type.enum';
import {
  type VeridianOidcConfig,
  type VeridianSamlConfig,
  type VeridianSsoConfig,
} from 'src/engine/core-modules/veridian-sso/types/veridian-sso-config.type';

export type CreateSsoProviderInput = {
  workspaceId: string;
  type: VeridianSsoProviderType;
  name: string;
  config: VeridianSsoConfig;
  isEnabled?: boolean;
};

@Injectable()
export class VeridianSsoProviderService {
  constructor(
    @InjectRepository(VeridianSsoProviderEntity)
    private readonly providerRepository: Repository<VeridianSsoProviderEntity>,
    private readonly secretEncryptionService: SecretEncryptionService,
  ) {}

  async create(
    input: CreateSsoProviderInput,
  ): Promise<VeridianSsoProviderEntity> {
    const encryptedConfig = this.encryptConfig(input.config, input.workspaceId);

    const provider = this.providerRepository.create({
      workspaceId: input.workspaceId,
      type: input.type,
      name: input.name,
      isEnabled: input.isEnabled ?? true,
      encryptedConfig,
    });

    return this.providerRepository.save(provider);
  }

  async updateConfig(
    id: string,
    config: VeridianSsoConfig,
  ): Promise<VeridianSsoProviderEntity> {
    const provider = await this.findByIdOrThrow(id);

    provider.encryptedConfig = this.encryptConfig(config, provider.workspaceId);

    return this.providerRepository.save(provider);
  }

  async setEnabled(
    id: string,
    isEnabled: boolean,
  ): Promise<VeridianSsoProviderEntity> {
    const provider = await this.findByIdOrThrow(id);

    provider.isEnabled = isEnabled;

    return this.providerRepository.save(provider);
  }

  async delete(id: string): Promise<void> {
    await this.providerRepository.delete({ id });
  }

  async listByWorkspace(
    workspaceId: string,
  ): Promise<VeridianSsoProviderEntity[]> {
    return this.providerRepository.find({ where: { workspaceId } });
  }

  /**
   * Récupère un provider actif par son id. Un id inconnu ou un provider
   * désactivé lève une 404 (pas de fuite d'info sur l'existence).
   */
  async findEnabledByIdOrThrow(
    id: string,
  ): Promise<VeridianSsoProviderEntity> {
    const provider = await this.providerRepository.findOne({
      where: { id, isEnabled: true },
    });

    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    return provider;
  }

  /** Déchiffre la config IdP d'un provider donné. */
  getDecryptedConfig(provider: VeridianSsoProviderEntity): VeridianSsoConfig {
    const plaintext = this.secretEncryptionService.decryptVersionedOrThrow(
      provider.encryptedConfig as EncryptedString,
      { workspaceId: provider.workspaceId },
    );

    return JSON.parse(plaintext) as VeridianSsoConfig;
  }

  getDecryptedSamlConfig(
    provider: VeridianSsoProviderEntity,
  ): VeridianSamlConfig {
    this.assertType(provider, VeridianSsoProviderType.SAML);

    return this.getDecryptedConfig(provider) as VeridianSamlConfig;
  }

  getDecryptedOidcConfig(
    provider: VeridianSsoProviderEntity,
  ): VeridianOidcConfig {
    this.assertType(provider, VeridianSsoProviderType.OIDC);

    return this.getDecryptedConfig(provider) as VeridianOidcConfig;
  }

  private assertType(
    provider: VeridianSsoProviderEntity,
    expected: VeridianSsoProviderType,
  ): void {
    if (provider.type !== expected) {
      throw new NotFoundException('SSO provider not found');
    }
  }

  private async findByIdOrThrow(
    id: string,
  ): Promise<VeridianSsoProviderEntity> {
    const provider = await this.providerRepository.findOne({ where: { id } });

    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    return provider;
  }

  private encryptConfig(
    config: VeridianSsoConfig,
    workspaceId: string,
  ): string {
    return this.secretEncryptionService.encryptVersioned(
      JSON.stringify(config) as PlaintextString,
      { workspaceId },
    );
  }
}
