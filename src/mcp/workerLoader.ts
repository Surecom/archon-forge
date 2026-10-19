/**
 * Lazy loader for the bundled archon-mcp Worker.
 *
 * The Worker bundle is shipped as `archon-mcp/dist-browser/worker.js`.
 * We import it via `?worker&inline` so Vite embeds the entire worker as
 * a base64 Blob inside `index.js`. This is REQUIRED for the marketplace
 * deployment — the host serves us at `/plugins/archon-forge/index.js`
 * and never serves the `/assets/worker-XXX.js` chunk a plain `?worker`
 * import would reference, so non-inline workers 404 silently and time
 * out forever (the Worker constructor is synchronous and gives no error
 * for missing scripts; the script load failure is dispatched as an
 * `error` event later, but by then the boot has already started a
 * `postMessage` to a worker that will never respond).
 *
 * If `?worker&inline` ever fails (e.g. a host that doesn't run Vite at
 * all), we fall back to fetching the worker bundle from a few known
 * paths and constructing it via a Blob URL.
 *
 * All boot phases are logged with `[archon-forge]` console prefix so
 * users can audit "is it slow or hung?" from DevTools.
 */

let cached: Worker | null = null;

export type WorkerLoadPhase =
  | 'vite-import'
  | 'fetch-fallback'
  | 'constructing'
  | 'ready';

export interface WorkerLoadProgress {
  phase: WorkerLoadPhase;
  detail?: string;
  /** Milliseconds elapsed since start of getArchonMcpWorker(). */
  elapsedMs: number;
}

const log = (...args: unknown[]) => console.info('[archon-forge]', ...args);
const warn = (...args: unknown[]) => console.warn('[archon-forge]', ...args);

export async function getArchonMcpWorker(
  onProgress?: (p: WorkerLoadProgress) => void,
): Promise<Worker> {
  if (cached) return cached;

  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  const report = (phase: WorkerLoadPhase, detail?: string) => {
    onProgress?.({ phase, detail, elapsedMs: since() });
  };

  // Strategy 1: Vite `?worker&inline` import — embeds the worker as a
  // base64 Blob inside index.js. CRITICAL for the marketplace deployment:
  // the host serves us at /plugins/archon-forge/index.js and never serves
  // the /assets/worker-XXX.js chunk that a plain `?worker` import would
  // reference, so non-inline workers 404 silently and time out.
  report('vite-import', 'attempting Vite ?worker&inline import');
  try {
    log('worker boot: trying Vite ?worker&inline import…');
    // @ts-ignore — virtual module, resolved by Vite.
    const Mod = await import('archon-mcp/dist-browser/worker.js?worker&inline');
    if (Mod && typeof Mod.default === 'function') {
      report('constructing', 'instantiating inline worker');
      cached = new (Mod.default as unknown as { new (): Worker })();
      report('ready', `vite ?worker&inline → constructed in ${since()}ms`);
      log(`worker constructed via Vite ?worker&inline import in ${since()}ms`);
      return cached;
    }
    warn('Vite ?worker&inline import returned no default export — falling back to fetch.');
  } catch (err) {
    warn('Vite ?worker&inline import threw — falling back to fetch:', err);
  }

  // Strategy 2: fetch-and-Blob from known marketplace paths.
  const candidates = [
    '/plugins/archon-forge/worker.js',
    '/plugins/archon-forge/dist-browser/worker.js',
    new URL('./worker.js', (import.meta as any).url || location.href).toString(),
  ];

  for (const url of candidates) {
    report('fetch-fallback', `GET ${url}`);
    try {
      log(`worker boot: GET ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        warn(`worker fetch ${url} → ${res.status} ${res.statusText}`);
        continue;
      }
      const code = await res.text();
      report('constructing', `Blob worker from ${url} (${(code.length / 1024).toFixed(0)}KB)`);
      const blob = new Blob([code], { type: 'application/javascript' });
      cached = new Worker(URL.createObjectURL(blob), { type: 'module' });
      report('ready', `fetch fallback → constructed in ${since()}ms`);
      log(`worker loaded from ${url} in ${since()}ms`);
      return cached;
    } catch (err) {
      warn(`worker fetch ${url} threw:`, err);
    }
  }

  throw new Error(
    `Unable to load archon-mcp worker after ${since()}ms. ` +
      'Tried Vite ?worker import and fetched: ' + candidates.join(', ') +
      '. Open DevTools → Console for [archon-forge] diagnostics.',
  );
}

export function disposeArchonMcpWorker(): void {
  if (!cached) return;
  cached.terminate();
  cached = null;
}
