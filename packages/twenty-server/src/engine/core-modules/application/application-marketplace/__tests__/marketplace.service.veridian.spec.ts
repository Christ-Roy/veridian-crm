import { Test, type TestingModule } from '@nestjs/testing';

import axios from 'axios';

import { MarketplaceService } from 'src/engine/core-modules/application/application-marketplace/marketplace.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

jest.mock('axios');

// Veridian: with MARKETPLACE_REGISTRY_SYNC_ENABLED=false (the default), no
// outbound HTTP call to npmjs.org/unpkg.com may ever be issued
// (see todo/2026-05-27-P0-couper-leaks-outbound-twenty-labs.md)
describe('MarketplaceService (Veridian outbound guard)', () => {
  let service: MarketplaceService;
  let mockConfigGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigGet = jest.fn().mockImplementation((key: string) => {
      if (key === 'MARKETPLACE_REGISTRY_SYNC_ENABLED') return false;
      if (key === 'APP_REGISTRY_URL') return 'https://registry.npmjs.org';
      if (key === 'APP_REGISTRY_CDN_URL') return 'https://unpkg.com';

      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        {
          provide: TwentyConfigService,
          useValue: { get: mockConfigGet },
        },
      ],
    }).compile();

    service = module.get<MarketplaceService>(MarketplaceService);
  });

  it('fetchAppsFromRegistry returns [] without any HTTP call', async () => {
    const result = await service.fetchAppsFromRegistry();

    expect(result).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('fetchManifestFromRegistryCdn returns null without any HTTP call', async () => {
    const result = await service.fetchManifestFromRegistryCdn('pkg', '1.0.0');

    expect(result).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('fetchReadmeFromRegistryCdn returns null without any HTTP call', async () => {
    const result = await service.fetchReadmeFromRegistryCdn('pkg', '1.0.0');

    expect(result).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });
});
