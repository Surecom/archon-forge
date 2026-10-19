import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import type { ArchonPluginAPI, AutoLayoutEngineId } from './types';
import ChatView from './chat/ChatView';
import SetupWizard from './settings/SetupWizard';
import WindowHeaderSlot from './ui/WindowHeaderSlot';
import { ForgeSettings, isValid, loadSettings, saveSettings } from './settings/storage';
import { getProvider } from './providers/registry';
import { useChatSession } from './chat/useChatSession';
import { disposeArchonMcpWorker, getArchonMcpWorker } from './mcp/workerLoader';
import { createMcpClient, McpClient } from './mcp/mcpClient';
import { createStateBridge, StateBridge } from './mcp/stateBridge';
import { useHostContext } from './host/useHostContext';
import { I18nProvider, useI18n } from './i18n';

export type McpBootStatus = 'idle' | 'booting' | 'ready' | 'error';

/** Hard ceiling for worker fetch + RPC initialize, so a hang becomes a Retry button. */
const BOOT_TIMEOUT_MS = 60_000;

interface Engine {
  mcp: McpClient;
  bridge: StateBridge;
}

function useMcpEngine(api: ArchonPluginAPI, enabled: boolean) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<McpBootStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const bootingRef = useRef(false);

  const boot = useCallback(async () => {
    if (bootingRef.current) return;
    bootingRef.current = true;
    setStatus('booting');
    setError(null);
    const t0 = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`archon-mcp did not start within ${BOOT_TIMEOUT_MS / 1000}s`)), BOOT_TIMEOUT_MS);
    });
    try {
      const next = await Promise.race([
        (async () => {
          const worker = await getArchonMcpWorker(p => console.info(`[archon-forge] worker ${p.phase} (${p.elapsedMs}ms)`));
          const mcp = createMcpClient(worker);
          await mcp.initialize('archon-forge', typeof __PLUGIN_VERSION__ !== 'undefined' ? __PLUGIN_VERSION__ : '0.0.0');
          return { mcp, bridge: createStateBridge(api, mcp) };
        })(),
        deadline,
      ]);
      console.info(`[archon-forge] engine ready in ${Math.round(performance.now() - t0)}ms`);
      setEngine(next);
      setStatus('ready');
    } catch (err) {
      console.error('[archon-forge] engine boot failed:', err);
      setError((err as Error)?.message ?? String(err));
      setStatus('error');
    } finally {
      if (timer) clearTimeout(timer);
      bootingRef.current = false;
    }
  }, [api]);

  useEffect(() => {
    if (enabled && status === 'idle') void boot();
  }, [enabled, status, boot]);

  const retry = useCallback(() => {
    engine?.mcp.close();
    disposeArchonMcpWorker();
    setEngine(null);
    setStatus('idle');
  }, [engine]);

  return { engine, status, error, retry };
}

const ForgeApp: React.FC<{ api: ArchonPluginAPI }> = ({ api }) => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ForgeSettings | null>(() => loadSettings());
  const [editing, setEditing] = useState(false);
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  const host = useHostContext(api);

  const valid = isValid(settings);
  const provider = useMemo(() => getProvider(settings?.providerId) ?? null, [settings]);
  const { engine, status, error, retry } = useMcpEngine(api, valid);

  useEffect(() => { setHeaderEl(api.getWindowHeaderContainer?.() ?? null); }, [api]);

  const openSettings = useCallback(() => setEditing(true), []);

  const session = useChatSession({
    api,
    provider: valid ? provider : null,
    settings: valid ? settings : null,
    mcp: engine?.mcp ?? null,
    bridge: engine?.bridge ?? null,
    readOnly: host.readOnly,
    selectedLayerId: host.selectedLayerId,
    onAuthError: openSettings,
  });

  const runAutoLayout = useCallback(async (engineId: AutoLayoutEngineId) => {
    const result = await api.runAutoLayout?.({ engine: engineId, layerId: host.selectedLayerId });
    if (result && result.status !== 'applied' && result.status !== 'noop' && result.status !== 'cancelled') {
      api.showNotification(t('header.autoLayoutFailed', { reason: result.error ?? result.reason ?? result.status }), 'warning');
    }
  }, [api, host.selectedLayerId, t]);

  const complete = useCallback((next: ForgeSettings) => {
    saveSettings(next);
    setSettings(next);
    setEditing(false);
  }, []);

  const showWizard = !valid || editing;

  return (
    <div className="af-root" style={{ height: '100%' }}>
      {headerEl && ReactDOM.createPortal(
        <WindowHeaderSlot
          provider={valid ? provider : null}
          model={settings?.model}
          invalid={!valid}
          booting={valid && status === 'booting'}
          autoLayout={api.runAutoLayout ? {
            disabled: host.readOnly || session.running,
            running: host.autoLayoutRunning,
            run: engineId => { void runAutoLayout(engineId); },
          } : undefined}
          onOpenSettings={openSettings}
          onClearHistory={() => { void session.clear(); }}
        />,
        headerEl,
      )}
      {showWizard ? (
        <SetupWizard initial={settings} onComplete={complete} onCancel={valid ? () => setEditing(false) : undefined} />
      ) : (
        <ChatView
          session={session}
          mcpStatus={status}
          mcpError={error ?? undefined}
          onRetryMcp={retry}
          layerName={host.layerName}
          readOnly={host.readOnly}
        />
      )}
    </div>
  );
};

const ForgePlugin: React.FC<{ api: ArchonPluginAPI }> = ({ api }) => (
  <I18nProvider api={api}>
    <ForgeApp api={api} />
  </I18nProvider>
);

export default ForgePlugin;
