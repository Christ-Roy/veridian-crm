/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * Tests d'orchestration : règles d'unicité, idempotence, flip du flag
 * isCustomDomainEnabled, retrait. Repositories + resolver DNS mockés.
 */

import { type Repository } from 'typeorm';

import { type PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { VeridianCustomDomainService } from 'src/modules/veridian-custom-domain/services/veridian-custom-domain.service';
import { VeridianCustomDomainExceptionCode } from 'src/modules/veridian-custom-domain/veridian-custom-domain.exception';
import { type VeridianDnsResolverService } from 'src/modules/veridian-custom-domain/services/veridian-dns-resolver.service';

const makeWorkspace = (
  overrides: Partial<WorkspaceEntity> = {},
): WorkspaceEntity =>
  ({
    id: 'ws-1',
    customDomain: null,
    isCustomDomainEnabled: false,
    ...overrides,
  }) as WorkspaceEntity;

describe('VeridianCustomDomainService (Veridian clean-room custom domain)', () => {
  let service: VeridianCustomDomainService;
  let workspaceRepository: jest.Mocked<Repository<WorkspaceEntity>>;
  let publicDomainRepository: jest.Mocked<Repository<PublicDomainEntity>>;
  let dnsResolver: jest.Mocked<VeridianDnsResolverService>;

  beforeEach(() => {
    workspaceRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((w) => Promise.resolve(w)),
    } as unknown as jest.Mocked<Repository<WorkspaceEntity>>;

    publicDomainRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<Repository<PublicDomainEntity>>;

    dnsResolver = {
      isHostnameWorking: jest.fn().mockResolvedValue(false),
      checkRecords: jest.fn().mockResolvedValue([
        {
          validationType: 'redirection',
          type: 'cname',
          status: 'pending',
          key: 'crm.client.com',
          value: 'crm.veridian.site',
        },
      ]),
    } as unknown as jest.Mocked<VeridianDnsResolverService>;

    service = new VeridianCustomDomainService(
      workspaceRepository,
      publicDomainRepository,
      dnsResolver,
    );
  });

  describe('setCustomDomain', () => {
    it('persists a normalized domain and starts disabled', async () => {
      const workspace = makeWorkspace();

      const result = await service.setCustomDomain(workspace, '  CRM.Client.com ');

      expect(workspace.customDomain).toBe('crm.client.com');
      expect(workspace.isCustomDomainEnabled).toBe(false);
      expect(workspaceRepository.save).toHaveBeenCalledWith(workspace);
      expect(result.domain).toBe('crm.client.com');
      expect(result.isEnabled).toBe(false);
    });

    it('is a no-op when the same domain is set again', async () => {
      const workspace = makeWorkspace({ customDomain: 'crm.client.com' });

      await service.setCustomDomain(workspace, 'crm.client.com');

      expect(workspaceRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a domain already taken by another workspace', async () => {
      workspaceRepository.findOne.mockResolvedValue(
        makeWorkspace({ id: 'other-ws', customDomain: 'crm.client.com' }),
      );

      await expect(
        service.setCustomDomain(makeWorkspace(), 'crm.client.com'),
      ).rejects.toMatchObject({
        code: VeridianCustomDomainExceptionCode.DOMAIN_ALREADY_TAKEN,
      });
      expect(workspaceRepository.save).not.toHaveBeenCalled();
    });

    it('allows re-claiming a domain already owned by the same workspace', async () => {
      workspaceRepository.findOne.mockResolvedValue(
        makeWorkspace({ id: 'ws-1', customDomain: 'crm.client.com' }),
      );

      await expect(
        service.setCustomDomain(makeWorkspace({ id: 'ws-1' }), 'crm.client.com'),
      ).resolves.toBeDefined();
    });

    it('rejects a domain already registered as a public domain', async () => {
      publicDomainRepository.findOneBy.mockResolvedValue({
        domain: 'crm.client.com',
      } as PublicDomainEntity);

      await expect(
        service.setCustomDomain(makeWorkspace(), 'crm.client.com'),
      ).rejects.toMatchObject({
        code: VeridianCustomDomainExceptionCode.DOMAIN_ALREADY_REGISTERED_AS_PUBLIC_DOMAIN,
      });
    });
  });

  describe('checkCustomDomain', () => {
    it('throws when no custom domain is set', async () => {
      await expect(
        service.checkCustomDomain(makeWorkspace()),
      ).rejects.toMatchObject({
        code: VeridianCustomDomainExceptionCode.NO_CUSTOM_DOMAIN_SET,
      });
    });

    it('flips isCustomDomainEnabled to true and persists when DNS works', async () => {
      const workspace = makeWorkspace({
        customDomain: 'crm.client.com',
        isCustomDomainEnabled: false,
      });
      dnsResolver.isHostnameWorking.mockResolvedValue(true);

      const result = await service.checkCustomDomain(workspace);

      expect(workspace.isCustomDomainEnabled).toBe(true);
      expect(workspaceRepository.save).toHaveBeenCalledWith(workspace);
      expect(result.isEnabled).toBe(true);
    });

    it('does not persist when the flag is already in sync', async () => {
      const workspace = makeWorkspace({
        customDomain: 'crm.client.com',
        isCustomDomainEnabled: true,
      });
      dnsResolver.isHostnameWorking.mockResolvedValue(true);

      await service.checkCustomDomain(workspace);

      expect(workspaceRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('removeCustomDomain', () => {
    it('clears the domain and the flag', async () => {
      const workspace = makeWorkspace({
        customDomain: 'crm.client.com',
        isCustomDomainEnabled: true,
      });

      const result = await service.removeCustomDomain(workspace);

      expect(result).toBe(true);
      expect(workspace.customDomain).toBeNull();
      expect(workspace.isCustomDomainEnabled).toBe(false);
      expect(workspaceRepository.save).toHaveBeenCalledWith(workspace);
    });

    it('is a no-op when there is no domain', async () => {
      const workspace = makeWorkspace();

      await service.removeCustomDomain(workspace);

      expect(workspaceRepository.save).not.toHaveBeenCalled();
    });
  });
});
