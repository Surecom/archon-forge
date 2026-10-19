import { describe, expect, it, vi } from 'vitest';
import { runTurn, type TurnDeps } from '../turnEngine';
import type { McpClient } from '../../mcp/mcpClient';
import type { StateBridge } from '../../mcp/stateBridge';
import type { ProviderEvent, ProviderSession, ToolResult } from '../../providers/types';

const OPS = [{ kind: 'addSystem', payload: { id: 's1' } }];

function fakeMcp(): McpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    initialize: async () => undefined,
    listTools: async () => [],
    callTool: async name => {
      calls.push(name);
      return { content: [{ type: 'text', text: `${name} ok` }] };
    },
    close: () => undefined,
  };
}

const fakeBridge = (): StateBridge & { hydrate: ReturnType<typeof vi.fn>; drain: ReturnType<typeof vi.fn> } => ({
  hydrate: vi.fn(async () => undefined),
  drain: vi.fn(async () => OPS),
});

/** A session that replays `script`, recording the tool results it receives. */
function scriptedSession(script: ProviderEvent[], onCall?: () => void): ProviderSession & { results: ToolResult[] } {
  const results: ToolResult[] = [];
  return {
    results,
    async *run() {
      for (const event of script) {
        const reply = yield event;
        if (event.kind === 'tool_call') {
          results.push(reply as ToolResult);
          onCall?.();
        }
      }
    },
    cancel: vi.fn(async () => undefined),
    reset: () => undefined,
  };
}

const input = {
  systemPrompt: 'sys',
  history: [],
  message: 'add payments',
  tools: [],
  context: { currentLayerId: 'L1' },
  retry: false,
};

const callbacks = { onText: () => undefined, onThinking: () => undefined, onToolCall: () => undefined, onToolResult: () => undefined };

describe('runTurn', () => {
  it('hydrates with the layer context, executes tools and returns the drained operations', async () => {
    const mcp = fakeMcp();
    const bridge = fakeBridge();
    const session = scriptedSession([
      { kind: 'tool_call', callId: 'c1', name: 'add_systems', args: { items: [] } },
      { kind: 'text', text: 'Done.' },
      { kind: 'done', status: 'finished' },
    ]);
    const deps: TurnDeps = { mcp, bridge, session, isCancelled: () => false };

    const outcome = await runTurn(input, deps, callbacks);

    expect(bridge.hydrate).toHaveBeenCalledWith({ currentLayerId: 'L1' });
    expect(mcp.calls).toEqual(['add_systems']);
    expect(session.results[0]).toEqual({ callId: 'c1', text: 'add_systems ok', isError: false });
    expect(outcome).toEqual({ status: 'finished', text: 'Done.', operations: OPS });
  });

  it('never executes auto_layout and tells the model why', async () => {
    const mcp = fakeMcp();
    const session = scriptedSession([
      { kind: 'tool_call', callId: 'c1', name: 'auto_layout', args: {} },
      { kind: 'done', status: 'finished' },
    ]);

    await runTurn(input, { mcp, bridge: fakeBridge(), session, isCancelled: () => false }, callbacks);

    expect(mcp.calls).toEqual([]);
    expect(session.results[0].isError).toBe(true);
    expect(session.results[0].text).toMatch(/user's decision/);
  });

  it('returns no operations when the user cancels mid-turn', async () => {
    let cancelled = false;
    const bridge = fakeBridge();
    const session = scriptedSession([
      { kind: 'tool_call', callId: 'c1', name: 'add_systems', args: {} },
      { kind: 'done', status: 'cancelled' },
    ], () => { cancelled = true; });

    const outcome = await runTurn(input, { mcp: fakeMcp(), bridge, session, isCancelled: () => cancelled }, callbacks);

    expect(outcome.status).toBe('cancelled');
    expect(outcome.operations).toEqual([]);
    expect(bridge.drain).not.toHaveBeenCalled();
  });

  it('marks a failing tool result as an error for the model', async () => {
    const mcp = fakeMcp();
    mcp.callTool = async () => ({ content: [{ type: 'text', text: 'Error: System "X" not found' }], isError: true });
    const session = scriptedSession([
      { kind: 'tool_call', callId: 'c1', name: 'update_system', args: {} },
      { kind: 'done', status: 'finished' },
    ]);

    await runTurn(input, { mcp, bridge: fakeBridge(), session, isCancelled: () => false }, callbacks);

    expect(session.results[0]).toEqual({ callId: 'c1', text: 'Error: System "X" not found', isError: true });
  });
});
