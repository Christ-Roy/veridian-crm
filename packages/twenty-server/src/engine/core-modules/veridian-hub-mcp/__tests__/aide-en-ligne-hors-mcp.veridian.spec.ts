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
