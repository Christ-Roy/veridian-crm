// search_help_center only queries docs.twenty.com: with the search cut, it can only fail,
// so MCP clients must not see it (parente, 09/11/2026). Upstream has no switch for it:
// VeridianHelpCenterGate edits the two exported collections the MCP readers consult.
const GATE_PATH =
  'src/engine/core-modules/veridian-hub-mcp/services/veridian-help-center-gate.service';

const MOCKED_SERVICES: [string, string][] = [
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
];

type Served = {
  excluded: Set<string>;
  preload: string[];
  preloadAsked: string[];
  toolNames: string[];
};

// Real constants and the real McpProtocolService tool set, in a fresh module registry.
const serve = async ({
  enabled,
  gate,
}: {
  enabled?: string;
  gate: 'class' | 'none';
}): Promise<Served> => {
  if (enabled === undefined) {
    delete process.env.HELP_CENTER_SEARCH_ENABLED;
  } else {
    process.env.HELP_CENTER_SEARCH_ENABLED = enabled;
  }

  let served!: Served;

  await jest.isolateModulesAsync(async () => {
    // Injected services pull the whole engine; the tool set itself only needs the registry.
    for (const [path, name] of MOCKED_SERVICES) {
      jest.doMock(path, () => ({ [name]: class {} }));
    }

    if (gate === 'class') {
      const { VeridianHelpCenterGate } = require(GATE_PATH);

      new VeridianHelpCenterGate().onModuleInit();
    }

    const {
      MCP_EXCLUDED_TOOL_NAMES,
    } = require('src/engine/api/mcp/constants/mcp-excluded-tool-names.constant');
    const {
      COMMON_PRELOAD_TOOLS,
    } = require('src/engine/core-modules/tool-provider/constants/common-preload-tools.const');
    const {
      McpProtocolService,
    } = require('src/engine/api/mcp/services/mcp-protocol.service');
    const preloadAsked: string[] = [];
    const toolRegistry = {
      getToolsByName: jest.fn(async (names: string[]) => {
        preloadAsked.push(...names);

        return Object.fromEntries(
          names.map((name) => [name, { description: name, inputSchema: {} }]),
        );
      }),
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
    const { toolSet } = await service['buildMcpToolSet']({ id: 'ws-1' });

    served = {
      excluded: MCP_EXCLUDED_TOOL_NAMES,
      preload: COMMON_PRELOAD_TOOLS,
      preloadAsked,
      toolNames: Object.keys(toolSet),
    };
  });

  return served;
};

describe('search_help_center out of MCP while the search is cut', () => {
  afterEach(() => {
    delete process.env.HELP_CENTER_SEARCH_ENABLED;
  });

  it('is closed by the gate, in the exclusion set and the preload list', async () => {
    const served = await serve({ gate: 'class' });

    expect(served.excluded.has('search_help_center')).toBe(true);
    expect(served.excluded.has('code_interpreter')).toBe(true);
    expect(served.preload).not.toContain('search_help_center');
  });

  it('is absent from the tool set an MCP client receives', async () => {
    const served = await serve({ gate: 'class' });

    expect(served.preloadAsked).not.toContain('search_help_center');
    expect(served.toolNames).not.toContain('search_help_center');
    expect(served.toolNames.length).toBeGreaterThan(0);
  });

  it('is served without the gate (the reader sees the tool, so the check bites)', async () => {
    const served = await serve({ gate: 'none' });

    expect(served.excluded.has('search_help_center')).toBe(false);
    expect(served.toolNames).toContain('search_help_center');
  });

  it('comes back once the search is explicitly enabled', async () => {
    const served = await serve({ enabled: 'true', gate: 'class' });

    expect(served.excluded.has('search_help_center')).toBe(false);
    expect(served.preload).toContain('search_help_center');
    expect(served.toolNames).toContain('search_help_center');
  });

  it('is idempotent', async () => {
    let names: string[] = [];

    jest.isolateModules(() => {
      delete process.env.HELP_CENTER_SEARCH_ENABLED;

      const { closeHelpCenterToolForMcp } = require(GATE_PATH);
      const {
        COMMON_PRELOAD_TOOLS,
      } = require('src/engine/core-modules/tool-provider/constants/common-preload-tools.const');

      closeHelpCenterToolForMcp();
      closeHelpCenterToolForMcp();
      names = COMMON_PRELOAD_TOOLS;
    });

    expect(names.filter((name) => name === 'search_help_center')).toEqual([]);
  });
});
