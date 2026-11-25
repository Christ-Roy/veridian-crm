import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Like, type Repository } from 'typeorm';

import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { type EncryptedString } from 'src/engine/core-modules/secret-encryption/branded-strings/encrypted-string.type';
import { type PlaintextString } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type HubGrant } from 'src/engine/core-modules/veridian-delegation/utils/parse-hub-grants.util';

const GRANT_KEY = 'veridian.hub_grant';
const TENANT_KEY_PREFIX = 'veridian.hub_tenant:';

type StoredGrant = { grant: EncryptedString; expiresAt: string };

// What the Hub hands over at sign-in: it lets this person act, from this workspace, in another Veridian app.
// It stays on the server, encrypted; the Hub kills it when the person leaves, is suspended or signs out.
@Injectable()
export class VeridianGrantService {
  private readonly logger = new Logger(VeridianGrantService.name);

  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    private readonly secretEncryptionService: SecretEncryptionService,
  ) {}

  // A grant carried by a sign-in never blocks the sign-in.
  async storeAtSignIn(hubUserId: string, grants: HubGrant[]): Promise<void> {
    if (grants.length === 0) {
      return;
    }

    try {
      const hubUser = await this.keyValuePairRepository.findOne({
        where: { key: `veridian.hub_user:${hubUserId}`, workspaceId: IsNull() },
      });

      if (!hubUser?.userId) {
        return;
      }

      for (const { hubTenantId, grant, expiresAt } of grants) {
        const tenant = await this.keyValuePairRepository.findOne({
          where: {
            key: `${TENANT_KEY_PREFIX}${hubTenantId}`,
            userId: IsNull(),
          },
        });

        if (!tenant?.workspaceId) {
          continue;
        }

        const stored: StoredGrant = {
          grant: this.secretEncryptionService.encryptVersioned(
            grant as PlaintextString,
            { workspaceId: tenant.workspaceId },
          ),
          expiresAt,
        };

        await this.keyValuePairRepository.upsert(
          {
            key: GRANT_KEY,
            userId: hubUser.userId,
            workspaceId: tenant.workspaceId,
            type: KeyValuePairType.USER_VARIABLE,
            value: stored as unknown as JSON,
          },
          ['key', 'userId', 'workspaceId'],
        );
      }
    } catch (error) {
      this.logger.warn(
        `Hub grant not stored sub=${hubUserId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async read(userId: string, workspaceId: string): Promise<string | null> {
    const row = await this.keyValuePairRepository.findOne({
      where: { key: GRANT_KEY, userId, workspaceId },
    });
    const stored = row?.value as unknown as StoredGrant | undefined;

    if (!stored?.grant || new Date(stored.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    try {
      return this.secretEncryptionService.decryptVersionedOrThrow(
        stored.grant,
        {
          workspaceId,
        },
      );
    } catch {
      return null;
    }
  }

  async forget(userId: string, workspaceId: string): Promise<void> {
    await this.keyValuePairRepository.delete({
      key: GRANT_KEY,
      userId,
      workspaceId,
    });
  }

  async findHubTenantId(workspaceId: string): Promise<string | null> {
    const tenant = await this.keyValuePairRepository.findOne({
      where: {
        key: Like(`${TENANT_KEY_PREFIX}%`),
        workspaceId,
        userId: IsNull(),
      },
    });

    return tenant?.key.slice(TENANT_KEY_PREFIX.length).toLowerCase() ?? null;
  }
}
