/**
 * stateBridge — the worker side of a chat turn.
 *
 *   start of a turn:  load_project_state(host project, { currentLayerId })
 *   end of a turn:    get_operations → the caller applies them ONCE
 *
 * Draining is separate from applying so a cancelled or failed turn can throw
 * its operations away: the host project is untouched until the turn succeeds.
 */
import type { ArchonPluginAPI, McpOperation } from '../types';
import type { McpClient } from './mcpClient';

export interface HostContext {
  currentLayerId: string | null;
}

export interface StateBridge {
  hydrate(context: HostContext): Promise<void>;
  drain(): Promise<McpOperation[]>;
}

export function createStateBridge(api: ArchonPluginAPI, mcp: McpClient): StateBridge {
  return {
    async hydrate(context) {
      await mcp.callTool('load_project_state', {
        state: api.getProjectState(),
        context: context.currentLayerId ? { currentLayerId: context.currentLayerId } : undefined,
      });
    },
    async drain() {
      const res = await mcp.callTool('get_operations', {});
      const text = res.content?.[0]?.text;
      if (!text) return [];
      const parsed = JSON.parse(text) as { operations?: McpOperation[] };
      return parsed.operations ?? [];
    },
  };
}
