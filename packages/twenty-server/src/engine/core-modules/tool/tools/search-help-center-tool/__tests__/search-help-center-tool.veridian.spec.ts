import { Test, type TestingModule } from '@nestjs/testing';

import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { SearchHelpCenterTool } from 'src/engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

// Veridian: with HELP_CENTER_SEARCH_ENABLED=false (the default), user
// queries must never be forwarded to twenty-help-search.com / Mintlify
// (see todo/2026-05-27-P0-couper-leaks-outbound-twenty-labs.md)
describe('SearchHelpCenterTool (Veridian outbound guard)', () => {
  let tool: SearchHelpCenterTool;
  let mockPost: jest.Mock;

  beforeEach(async () => {
    mockPost = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchHelpCenterTool,
        {
          provide: TwentyConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'HELP_CENTER_SEARCH_ENABLED') return false;

              return undefined;
            }),
          },
        },
        {
          provide: SecureHttpClientService,
          useValue: {
            getHttpClient: jest.fn().mockReturnValue({ post: mockPost }),
          },
        },
      ],
    }).compile();

    tool = module.get<SearchHelpCenterTool>(SearchHelpCenterTool);
  });

  it('returns an empty result without forwarding the query anywhere', async () => {
    const result = await tool.execute(
      { query: 'comment supprimer Christian Paris' },
      {} as ToolExecutionContext,
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
