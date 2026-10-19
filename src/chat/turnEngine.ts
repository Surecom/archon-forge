/**
 * One chat turn: hydrate the worker → run the provider → execute its tool
 * calls in the worker → drain the operations.
 *
 * The engine never touches the host project. It returns the turn's operations
 * and the caller applies them in ONE `applyMcpOperations` call, so a message is
 * a single undo step and a cancelled or failed turn leaves the project as it was.
 */
import type { McpClient } from '../mcp/mcpClient';
import type { HostContext, StateBridge } from '../mcp/stateBridge';
import type { McpOperation } from '../types';
import type { ProviderSession, RunStatus, ToolSchema, TranscriptMessage } from '../providers/types';
import { DENIED_TOOLS, deniedToolMessage } from './tools';

/** Guard against a runaway agent; a large "add this whole subsystem" turn stays well below. */
const MAX_TOOL_CALLS_PER_TURN = 200;

export interface ToolTrace {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export interface TurnInput {
  systemPrompt: string;
  history: TranscriptMessage[];
  message: string;
  tools: ToolSchema[];
  context: HostContext;
  retry: boolean;
}

export interface TurnDeps {
  mcp: McpClient;
  bridge: StateBridge;
  session: ProviderSession;
  isCancelled(): boolean;
}

export interface TurnCallbacks {
  onText(delta: string): void;
  onThinking(text: string): void;
  onToolCall(trace: ToolTrace): void;
  onToolResult(trace: ToolTrace): void;
}

export interface TurnOutcome {
  status: RunStatus;
  text: string;
  operations: McpOperation[];
}

async function executeTool(mcp: McpClient, trace: ToolTrace): Promise<ToolTrace> {
  if (DENIED_TOOLS.has(trace.name)) return { ...trace, result: deniedToolMessage(trace.name), isError: true };
  try {
    const res = await mcp.callTool(trace.name, trace.args);
    const text = (res.content ?? []).map(c => c.text).join('\n');
    return { ...trace, result: text, isError: !!res.isError || text.startsWith('Error:') };
  } catch (err) {
    return { ...trace, result: `Error: ${(err as Error)?.message ?? String(err)}`, isError: true };
  }
}

export async function runTurn(input: TurnInput, deps: TurnDeps, cb: TurnCallbacks): Promise<TurnOutcome> {
  const { mcp, bridge, session, isCancelled } = deps;
  await bridge.hydrate(input.context);

  const iterator = session.run({
    systemPrompt: input.systemPrompt,
    history: input.history,
    message: input.message,
    tools: input.tools,
    retry: input.retry,
  });

  let text = '';
  let status: RunStatus = 'finished';
  let toolCalls = 0;
  try {
    let step = await iterator.next();
    while (!step.done) {
      const event = step.value;
      if (event.kind === 'text') {
        text += event.text;
        cb.onText(event.text);
        step = await iterator.next();
      } else if (event.kind === 'thinking') {
        cb.onThinking(event.text);
        step = await iterator.next();
      } else if (event.kind === 'tool_call') {
        toolCalls += 1;
        if (toolCalls > MAX_TOOL_CALLS_PER_TURN) {
          await session.cancel();
          throw new Error(`Stopped after ${MAX_TOOL_CALLS_PER_TURN} tool calls in one message.`);
        }
        const call: ToolTrace = { callId: event.callId, name: event.name, args: event.args };
        cb.onToolCall(call);
        const done = isCancelled() ? { ...call, result: 'Cancelled by the user.', isError: true } : await executeTool(mcp, call);
        cb.onToolResult(done);
        step = await iterator.next({ callId: done.callId, text: done.result ?? '', isError: !!done.isError });
      } else {
        status = event.status;
        if (!text && event.text) {
          text = event.text;
          cb.onText(event.text);
        }
        step = await iterator.next();
      }
    }
  } finally {
    await iterator.return?.(undefined);
  }

  // A discarded turn leaves its operations in the worker log; the next
  // `load_project_state` resets it, so nothing leaks into the next turn.
  if (isCancelled() || status !== 'finished') {
    return { status: isCancelled() ? 'cancelled' : status, text, operations: [] };
  }
  return { status, text, operations: await bridge.drain() };
}
