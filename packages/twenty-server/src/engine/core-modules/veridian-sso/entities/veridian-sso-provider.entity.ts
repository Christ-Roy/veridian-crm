/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * Config d'un fournisseur d'identité (IdP) SSO rattachée à un workspace.
 * `encryptedConfig` contient la config IdP (incl. clientSecret OIDC / certs)
 * chiffrée via SecretEncryptionService (AES-256-GCM, AAD = workspaceId) —
 * jamais en clair en base.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { VeridianSsoProviderType } from 'src/engine/core-modules/veridian-sso/enums/veridian-sso-provider-type.enum';
import { WorkspaceRelatedEntity } from 'src/engine/workspace-manager/types/workspace-related-entity';

@Entity({ name: 'veridianSsoProvider', schema: 'core' })
@Index('IDX_VERIDIAN_SSO_PROVIDER_WORKSPACE_ID', ['workspaceId'])
export class VeridianSsoProviderEntity extends WorkspaceRelatedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: VeridianSsoProviderType,
    nullable: false,
  })
  type: VeridianSsoProviderType;

  @Column({ type: 'varchar', nullable: false })
  name: string;

  @Column({ type: 'boolean', default: true, nullable: false })
  isEnabled: boolean;

  /** Config IdP chiffrée (enveloppe enc:v2 de SecretEncryptionService). */
  @Column({ type: 'text', nullable: false })
  encryptedConfig: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
