import { Injectable, type OnModuleInit } from '@nestjs/common';

import { MCP_EXCLUDED_TOOL_NAMES } from 'src/engine/api/mcp/constants/mcp-excluded-tool-names.constant';
import { COMMON_PRELOAD_TOOLS } from 'src/engine/core-modules/tool-provider/constants/common-preload-tools.const';

const HELP_CENTER_TOOL_NAME = 'search_help_center';

// Upstream exposes no switch for this tool, which sends the question to
// docs.twenty.com. Both MCP readers (exclusion set, preload list) read these
// exported collections at call time, so editing them in place closes the tool.
export const closeHelpCenterToolForMcp = (): void => {
  if (process.env.HELP_CENTER_SEARCH_ENABLED === 'true') {
    return;
  }

  MCP_EXCLUDED_TOOL_NAMES.add(HELP_CENTER_TOOL_NAME);

  for (let index = COMMON_PRELOAD_TOOLS.length - 1; index >= 0; index--) {
    if (COMMON_PRELOAD_TOOLS[index] === HELP_CENTER_TOOL_NAME) {
      COMMON_PRELOAD_TOOLS.splice(index, 1);
    }
  }
};

@Injectable()
export class VeridianHelpCenterGate implements OnModuleInit {
  onModuleInit(): void {
    closeHelpCenterToolForMcp();
  }
}
