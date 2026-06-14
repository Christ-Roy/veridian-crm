/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * Tests du resolver DNS/HTTPS clean-room : on vérifie qu'aucun appel réseau réel
 * n'est émis (dns + fetch mockés) et que la logique de validation est correcte.
 */

import { promises as dns } from 'dns';

import { DEFAULT_VERIDIAN_CUSTOM_DOMAIN_TARGET } from 'src/modules/veridian-custom-domain/constants/veridian-custom-domain.constants';
import { VeridianDnsResolverService } from 'src/modules/veridian-custom-domain/services/veridian-dns-resolver.service';

jest.mock('dns', () => ({
  promises: {
    resolveCname: jest.fn(),
  },
}));

const mockResolveCname = dns.resolveCname as jest.Mock;

describe('VeridianDnsResolverService (Veridian clean-room custom domain)', () => {
  let service: VeridianDnsResolverService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VERIDIAN_CUSTOM_DOMAIN_TARGET;
    service = new VeridianDnsResolverService();
    fetchSpy = jest.spyOn(global, 'fetch' as never);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('buildExpectedRecords', () => {
    it('returns a single CNAME pointing to the Veridian edge target', () => {
      const records = service.buildExpectedRecords('crm.client.com');

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        validationType: 'redirection',
        type: 'cname',
        key: 'crm.client.com',
        value: DEFAULT_VERIDIAN_CUSTOM_DOMAIN_TARGET,
      });
    });

    it('honours the VERIDIAN_CUSTOM_DOMAIN_TARGET override', () => {
      process.env.VERIDIAN_CUSTOM_DOMAIN_TARGET = 'crm.staging.veridian.site';

      const records = service.buildExpectedRecords('crm.client.com');

      expect(records[0].value).toBe('crm.staging.veridian.site');
    });
  });

  describe('resolveCname', () => {
    it('normalizes returned cnames (lowercase, no trailing dot)', async () => {
      mockResolveCname.mockResolvedValue(['CRM.Veridian.Site.']);

      const result = await service.resolveCname('crm.client.com');

      expect(result).toEqual(['crm.veridian.site']);
    });

    it('returns [] when the record does not exist (no throw)', async () => {
      mockResolveCname.mockRejectedValue(
        Object.assign(new Error('queryCname ENOTFOUND'), { code: 'ENOTFOUND' }),
      );

      const result = await service.resolveCname('crm.client.com');

      expect(result).toEqual([]);
    });
  });

  describe('isPointingToVeridian', () => {
    it('is true when the cname matches the target exactly', async () => {
      mockResolveCname.mockResolvedValue(['crm.veridian.site']);

      await expect(
        service.isPointingToVeridian('crm.client.com'),
      ).resolves.toBe(true);
    });

    it('is false when the cname points elsewhere', async () => {
      mockResolveCname.mockResolvedValue(['somewhere.else.com']);

      await expect(
        service.isPointingToVeridian('crm.client.com'),
      ).resolves.toBe(false);
    });
  });

  describe('isHttpsReachable', () => {
    it('is true on a 2xx healthz response', async () => {
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      await expect(
        service.isHttpsReachable('crm.client.com'),
      ).resolves.toBe(true);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://crm.client.com/healthz',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('is false on a non-ok response', async () => {
      fetchSpy.mockResolvedValue({ ok: false } as Response);

      await expect(
        service.isHttpsReachable('crm.client.com'),
      ).resolves.toBe(false);
    });

    it('is false when the request throws (TLS error / timeout)', async () => {
      fetchSpy.mockRejectedValue(new Error('fetch failed'));

      await expect(
        service.isHttpsReachable('crm.client.com'),
      ).resolves.toBe(false);
    });
  });

  describe('isHostnameWorking', () => {
    it('is true only when both DNS and HTTPS pass', async () => {
      mockResolveCname.mockResolvedValue(['crm.veridian.site']);
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      await expect(
        service.isHostnameWorking('crm.client.com'),
      ).resolves.toBe(true);
    });

    it('is false when DNS points elsewhere even if HTTPS responds', async () => {
      mockResolveCname.mockResolvedValue(['somewhere.else.com']);
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      await expect(
        service.isHostnameWorking('crm.client.com'),
      ).resolves.toBe(false);
    });
  });

  describe('checkRecords', () => {
    it('marks records active when the hostname works', async () => {
      mockResolveCname.mockResolvedValue(['crm.veridian.site']);
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      const records = await service.checkRecords('crm.client.com');

      expect(records[0].status).toBe('active');
    });

    it('marks records pending when the hostname is not ready', async () => {
      mockResolveCname.mockResolvedValue([]);
      fetchSpy.mockResolvedValue({ ok: false } as Response);

      const records = await service.checkRecords('crm.client.com');

      expect(records[0].status).toBe('pending');
    });
  });
});
