import { OUTPUT_NAVIGATION_TOOL_NAMES } from 'src/engine/core-modules/tool/tools/output-navigation-tool/constants/output-navigation-tool-names.constant';

export const MCP_EXCLUDED_TOOL_NAMES = new Set([
  'code_interpreter',
  'http_request',
  ...OUTPUT_NAVIGATION_TOOL_NAMES,
  // Veridian: without HELP_CENTER_SEARCH_ENABLED the tool can only fail, so agents never see it.
  ...(process.env.HELP_CENTER_SEARCH_ENABLED === 'true'
    ? []
    : ['search_help_center']),
]);
