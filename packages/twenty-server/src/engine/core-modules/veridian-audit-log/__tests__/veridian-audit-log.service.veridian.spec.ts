/*
 * Veridian CRM — Append-only audit log, clean-room module (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Service tests: write side is append-only (INSERT only, never save/update/
 * delete); read side is scoped to a single workspace. No EE code.
 */

import { type Repository } from 'typeorm';

import { VeridianAuditLogActorTypeEnum } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { type VeridianAuditLogEntry } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-entry.type';
import { VeridianAuditLogService } from 'src/engine/core-modules/veridian-audit-log/services/veridian-audit-log.service';
import { type VeridianAuditLogEntity } from 'src/engine/core-modules/veridian-audit-log/veridian-audit-log.entity';

const makeEntry = (
  overrides: Partial<VeridianAuditLogEntry> = {},
): VeridianAuditLogEntry => ({
  workspaceId: 'ws-1',
  action: 'record.created',
  targetType: 'company',
  targetId: 'rec-1',
  actorUserId: 'user-1',
  actorType: VeridianAuditLogActorTypeEnum.USER,
  ...overrides,
});

describe('VeridianAuditLogService (Veridian clean-room audit log)', () => {
  let service: VeridianAuditLogService;
  let repository: jest.Mocked<Repository<VeridianAuditLogEntity>>;
  let queryBuilder: Record<string, jest.Mock>;

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    repository = {
      insert: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as jest.Mocked<Repository<VeridianAuditLogEntity>>;

    service = new VeridianAuditLogService(repository);
  });

  describe('insertEntries (append-only write)', () => {
    it('writes one row per entry via INSERT — the core "event → audit row" guarantee', async () => {
      await service.insertEntries([makeEntry(), makeEntry({ targetId: 'rec-2' })]);

      expect(repository.insert).toHaveBeenCalledTimes(1);
      const rows = repository.insert.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        workspaceId: 'ws-1',
        action: 'record.created',
        targetType: 'company',
        targetId: 'rec-1',
        actorUserId: 'user-1',
      });
    });

    it('NEVER uses save/update/delete (append-only invariant)', async () => {
      await service.insertEntries([makeEntry()]);

      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('is a no-op on an empty batch', async () => {
      await service.insertEntries([]);

      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('normalizes optional fields to null and parses occurredAt', async () => {
      await service.insertEntries([
        makeEntry({ targetType: undefined, occurredAt: '2026-06-14T10:00:00Z' }),
      ]);

      const rows = repository.insert.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(rows[0].targetType).toBeNull();
      expect(rows[0].occurredAt).toBeInstanceOf(Date);
    });
  });

  describe('findEntries (admin read)', () => {
    it('always scopes the read to the requested workspace', async () => {
      await service.findEntries({ workspaceId: 'ws-42' });

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'audit.workspaceId = :workspaceId',
        { workspaceId: 'ws-42' },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'audit.recordedAt',
        'DESC',
      );
    });

    it('applies the optional filters when provided', async () => {
      await service.findEntries({
        workspaceId: 'ws-1',
        action: 'auth.signed_in',
        actorUserId: 'user-1',
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'audit.action = :action',
        { action: 'auth.signed_in' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'audit.actorUserId = :actorUserId',
        { actorUserId: 'user-1' },
      );
    });

    it('caps the page size to the maximum', async () => {
      await service.findEntries({ workspaceId: 'ws-1', limit: 10_000 });

      expect(queryBuilder.take).toHaveBeenCalledWith(200);
    });
  });
});
