/**
 * mcpClient — minimal JSON-RPC client over postMessage. Talks to the
 * archon-mcp browser Worker via the in-process WorkerTransport.
 *
 * Uses numeric ids and a single in-flight map. Skips transport-level
 * features (streaming, resumption tokens) — Forge doesn't need them.
 */

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface McpClient {
  initialize(clientName: string, clientVersion: string): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): void;
}

interface Pending { resolve: (v: any) => void; reject: (err: any) => void; timer?: number; method: string; }

/** Default per-call timeout. The worker is in-process so anything taking
 *  longer than this is hung — better to surface than spin forever. */
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
/** initialize() can be slower because it triggers full worker module init. */
const INITIALIZE_TIMEOUT_MS = 45_000;

export function createMcpClient(worker: Worker): McpClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let closed = false;

  const settle = (id: number, ok: boolean, value: any) => {
    const slot = pending.get(id);
    if (!slot) return;
    pending.delete(id);
    if (slot.timer) clearTimeout(slot.timer);
    if (ok) slot.resolve(value); else slot.reject(value);
  };

  worker.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.jsonrpc !== '2.0') return;
    if (typeof msg.id !== 'number') return; // notifications ignored
    if (msg.error) settle(msg.id, false, new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    else settle(msg.id, true, msg.result);
  });

  const rejectAll = (reason: Error) => {
    for (const [id, slot] of pending) {
      if (slot.timer) clearTimeout(slot.timer);
      slot.reject(reason);
      pending.delete(id);
    }
  };

  worker.addEventListener('error', (ev: any) => {
    console.error('[archon-forge] worker error event:', ev);
    rejectAll(new Error(ev?.message || 'archon-mcp worker crashed (uncaught error)'));
  });
  worker.addEventListener('messageerror', (ev: any) => {
    console.error('[archon-forge] worker messageerror:', ev);
    rejectAll(new Error('archon-mcp worker sent a message that could not be deserialized'));
  });

  function rpc<T = any>(method: string, params: any, timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<T> {
    if (closed) return Promise.reject(new Error('mcpClient closed'));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(
        () => settle(id, false, new Error(
          `MCP rpc "${method}" timed out after ${timeoutMs}ms — worker is not responding. ` +
          'Open DevTools → Console for [archon-forge] diagnostics.',
        )),
        timeoutMs,
      ) as unknown as number;
      pending.set(id, { resolve, reject, timer, method });
      try {
        worker.postMessage({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        settle(id, false, err);
      }
    });
  }

  return {
    async initialize(clientName: string, clientVersion: string): Promise<void> {
      await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: clientName, version: clientVersion },
      }, INITIALIZE_TIMEOUT_MS);
      // Some MCP servers expect notifications/initialized after the response.
      worker.postMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    },

    async listTools(): Promise<McpToolDescriptor[]> {
      const result = await rpc<{ tools: McpToolDescriptor[] }>('tools/list', {});
      return result.tools || [];
    },

    async callTool(name: string, args: Record<string, unknown>) {
      return rpc<McpToolResult>('tools/call', { name, arguments: args ?? {} });
    },

    close() {
      closed = true;
      rejectAll(new Error('mcpClient closed'));
    },
  };
}
