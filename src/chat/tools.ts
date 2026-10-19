import type { McpToolDescriptor } from '../mcp/mcpClient';
import type { ToolSchema } from '../providers/types';

/**
 * Tools the model never gets:
 *  - auto_layout — re-laying out is the user's call (button in the window);
 *  - load_project_state / get_operations — Forge's own turn plumbing;
 *  - project lifecycle / installer tools — would replace or leave the host project.
 */
export const DENIED_TOOLS: ReadonlySet<string> = new Set([
  'auto_layout',
  'load_project_state',
  'get_operations',
  'create_project',
  'load_project',
  'save_project',
  'setup_cursor_rule',
  'setup_archon_skill',
]);

export const toModelTools = (tools: McpToolDescriptor[]): ToolSchema[] =>
  tools
    .filter(t => !DENIED_TOOLS.has(t.name))
    .map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

export const deniedToolMessage = (name: string): string =>
  name === 'auto_layout'
    ? 'auto_layout is not available. Layout is the user\'s decision — they can run it from the Forge window. Continue without it.'
    : `${name} is not available in Forge.`;
