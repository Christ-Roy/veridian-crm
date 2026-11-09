// search_help_center only queries docs.twenty.com: with the search cut, it can only fail,
// so MCP clients must not see it (parente, 09/11/2026).
const loadExcludedToolNames = (helpCenterSearchEnabled?: string) => {
  let names = new Set<string>();

  jest.isolateModules(() => {
    if (helpCenterSearchEnabled === undefined) {
      delete process.env.HELP_CENTER_SEARCH_ENABLED;
    } else {
      process.env.HELP_CENTER_SEARCH_ENABLED = helpCenterSearchEnabled;
    }

    names =
      require('src/engine/api/mcp/constants/mcp-excluded-tool-names.constant').MCP_EXCLUDED_TOOL_NAMES;
  });

  return names;
};

describe('search_help_center out of MCP while the search is cut', () => {
  afterEach(() => {
    delete process.env.HELP_CENTER_SEARCH_ENABLED;
  });

  it('is excluded by default', () => {
    expect(loadExcludedToolNames().has('search_help_center')).toBe(true);
  });

  it('comes back once the search is explicitly enabled', () => {
    expect(loadExcludedToolNames('true').has('search_help_center')).toBe(false);
  });
});

describe('search_help_center absent from what an MCP client receives', () => {
  it('is not preloaded into the tool set while the search is cut', async () => {
    delete process.env.HELP_CENTER_SEARCH_ENABLED;

    let toolSet: Record<string, unknown> = {};

    await jest.isolateModulesAsync(async () => {
      // Injected services pull the whole engine; the tool set itself only needs the registry.
      for (const [path, name] of [
        [
          'src/engine/api/mcp/services/mcp-instruction-builder.service',
          'McpInstructionBuilderService',
        ],
        [
          'src/engine/api/mcp/services/mcp-tool-executor.service',
          'McpToolExecutorService',
        ],
        [
          'src/engine/core-modules/tool-provider/services/tool-registry.service',
          'ToolRegistryService',
        ],
        [
          'src/engine/core-modules/exception-handler/exception-handler.service',
          'ExceptionHandlerService',
        ],
        ['src/engine/metadata-modules/skill/skill.service', 'SkillService'],
        [
          'src/engine/workspace-cache/services/workspace-cache.service',
          'WorkspaceCacheService',
        ],
        [
          'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service',
          'WorkspaceManyOrAllFlatEntityMapsCacheService',
        ],
      ]) {
        jest.doMock(path, () => ({ [name]: class {} }));
      }

      const {
        McpProtocolService,
      } = require('src/engine/api/mcp/services/mcp-protocol.service');
      const toolRegistry = {
        getToolsByName: jest.fn(async (names: string[]) =>
          Object.fromEntries(
            names.map((name) => [name, { description: name, inputSchema: {} }]),
          ),
        ),
      };
      const service = new McpProtocolService(
        toolRegistry,
        {},
        {},
        {},
        {},
        {},
        {},
      );

      ({ toolSet } = await service['buildMcpToolSet']({ id: 'ws-1' }));
    });

    expect(Object.keys(toolSet)).not.toContain('search_help_center');
    expect(Object.keys(toolSet).length).toBeGreaterThan(0);
  });
});
