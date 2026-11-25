import { MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS } from 'src/engine/api/mcp/constants/mcp-closed-world-read-only-tool-annotations.constant';
import { type McpToolAnnotations } from 'src/engine/api/mcp/types/mcp-tool-annotations.type';

// Native tools outside the record CRUD whose execute only reads (checked one by one, 24/11/2026): no write, no call
// outside the workspace. When in doubt a tool stays a write. Not listed on purpose: list_webhooks (targets and secrets),
// get_logic_function_source (server code), the validation-rule tools (Enterprise files).
export const VERIDIAN_MCP_NATIVE_READ_ONLY_TOOL_NAMES: readonly string[] = [
  'list_roles',
  'list_agents',
  'list_workflows',
  'list_workflow_runs',
  'get_workflow_run',
  'get_workflow_current_version',
  'list_dashboards',
  'get_dashboard',
  'list_navigation_menu_items',
  'get_views',
  'get_view_fields',
  'get_view_filters',
  'get_view_sorts',
  'get_view_query_parameters',
  'get_object_metadata',
  'get_field_metadata',
  'find_campaign_suppressions',
];

// Upstream gives "non destructive write" to every registry tool that is not a record CRUD, reads included. Hooked by
// getMcpRegistryToolAnnotations (VERIDIAN-PATCHES.md). A tool absent here keeps the upstream value.
export const VERIDIAN_MCP_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'list_available_apps',
  'search_records',
  'get_my_permissions',
  'get_record_email_threads',
  'get_record_calendar_events',
  'list_connected_accounts',
  'get_sync_status',
  'find_duplicate_records',
  'get_workspace_settings',
  'list_api_keys',
  'get_record_sharing',
  'api_lire',
  ...VERIDIAN_MCP_NATIVE_READ_ONLY_TOOL_NAMES,
]);

export const VERIDIAN_MCP_DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set(
  ['run_workflow', 'api_supprimer'],
);

const DESTRUCTIVE_TOOL_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: true,
};

export const findVeridianMcpToolAnnotations = (
  toolName: string,
): McpToolAnnotations | undefined => {
  if (VERIDIAN_MCP_READ_ONLY_TOOL_NAMES.has(toolName)) {
    return MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS;
  }

  if (VERIDIAN_MCP_DESTRUCTIVE_TOOL_NAMES.has(toolName)) {
    return DESTRUCTIVE_TOOL_ANNOTATIONS;
  }

  return undefined;
};
