/**
 * Minimal Server-Sent Events reader over a `fetch` body. `EventSource` cannot
 * send an `Authorization` header or a POST body, so Forge streams the run
 * response itself.
 */
export interface SseMessage {
  event: string;
  data: string;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const message = parseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (message) yield message;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseMessage | null {
  const lines = block.split('\n').filter(line => line && !line.startsWith(':'));
  if (!lines.length) return null;
  const field = (name: string) => lines
    .filter(line => line.startsWith(`${name}:`))
    .map(line => line.slice(name.length + 1).replace(/^ /, ''));
  return { event: field('event')[0] ?? 'message', data: field('data').join('\n') };
}
