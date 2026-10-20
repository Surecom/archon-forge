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
import { useLayerTabs } from './tabs/useLayerTabs';
import type { LayerTab } from './tabs/tabs';
import TabBar from './ui/TabBar';
import ConfirmDialog, { type ConfirmRequest } from './ui/ConfirmDialog';
import { I18nProvider, useI18n, type MessageKey } from './i18n';

export type McpBootStatus = 'idle' | 'booting' | 'ready' | 'error';

const ENGINE_LABELS: Record<AutoLayoutEngineId, MessageKey> = {
  'compact-grid': 'header.autoLayoutCompact',
  'orthogonal-flow': 'header.autoLayoutOrthogonal',
};

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
  const tabs = useLayerTabs(host);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const session = useChatSession({
    api,
    provider: valid ? provider : null,
    settings: valid ? settings : null,
    mcp: engine?.mcp ?? null,
    bridge: engine?.bridge ?? null,
    readOnly: host.readOnly,
    tab: tabs.active,
    onAuthError: openSettings,
  });

  // Auto layout works on the layer of the tab the user is looking at — which
  // may differ from the one on screen, so it is always confirmed first.
  const layoutLayerId = tabs.active?.available ? tabs.active.layerId : host.selectedLayerId;
  const layoutLayer = layoutLayerId ? host.layers[layoutLayerId] ?? null : null;
  const askAutoLayout = useCallback((engineId: AutoLayoutEngineId) => {
    if (!layoutLayer) return;
    setConfirm({
      title: t('confirm.layoutTitle'),
      body: t('confirm.layoutBody'),
      tone: 'primary',
      subject: [
        { label: t('confirm.layer'), value: layoutLayer.name, color: layoutLayer.color },
        { label: t('confirm.layoutEngine'), value: t(ENGINE_LABELS[engineId]) },
      ],
      warning: layoutLayer.id !== host.selectedLayerId ? t('confirm.layoutNotShown') : undefined,
      onConfirm: () => {
        setConfirm(null);
        void api.runAutoLayout?.({ engine: engineId, layerId: layoutLayer.id }).then(result => {
          if (result.status !== 'applied' && result.status !== 'noop' && result.status !== 'cancelled') {
            api.showNotification(t('header.autoLayoutFailed', { reason: result.error ?? result.reason ?? result.status }), 'warning');
          }
        });
      },
    });
  }, [api, layoutLayer, host.selectedLayerId, t]);

  const layerSubject = (tab: LayerTab) => [{ label: t('confirm.layer'), value: tab.name, color: tab.available ? tab.color : undefined }];

  const askCloseTab = useCallback((tab: LayerTab) => setConfirm({
    title: t('confirm.closeTitle', { layer: tab.name }),
    body: t('confirm.closeBody'),
    subject: layerSubject(tab),
    onConfirm: () => {
      setConfirm(null);
      tabs.close(tab.key);
      void session.clearTab(tab.key);
    },
  }), [t, tabs, session]);

  const askClearTab = useCallback(() => {
    const tab = tabs.active;
    if (!tab) return;
    setConfirm({
      title: t('confirm.clearTitle', { layer: tab.name }),
      body: t('confirm.clearBody'),
      subject: layerSubject(tab),
      onConfirm: () => {
        setConfirm(null);
        void session.clearTab(tab.key);
      },
    });
  }, [t, tabs.active, session]);

  const runningTab = tabs.tabs.find(tab => tab.key === session.runningTabKey) ?? null;
  const otherRunningTab = runningTab && runningTab.key !== tabs.active?.key ? runningTab.name : null;
  const closedCurrentLayer = tabs.canOpenCurrent && host.selectedLayerId ? host.layers[host.selectedLayerId]?.name ?? null : null;

  const complete = useCallback((next: ForgeSettings) => {
    saveSettings(next);
    setSettings(next);
    setEditing(false);
  }, []);

  const showWizard = !valid || editing;

  return (
    // Re-read layer names by ID whenever the user comes back to the window.
    <div className="af-root af-shell" onFocusCapture={host.refresh} onPointerEnter={host.refresh}>
      {headerEl && ReactDOM.createPortal(
        <WindowHeaderSlot
          provider={valid ? provider : null}
          model={settings?.model}
          invalid={!valid}
          booting={valid && status === 'booting'}
          autoLayout={api.runAutoLayout ? {
            disabled: host.readOnly || session.running || !layoutLayer,
            running: host.autoLayoutRunning,
            run: askAutoLayout,
          } : undefined}
          onOpenSettings={openSettings}
          onClearHistory={tabs.active && !showWizard ? askClearTab : undefined}
        />,
        headerEl,
      )}
      {showWizard ? (
        <SetupWizard initial={settings} onComplete={complete} onCancel={valid ? () => setEditing(false) : undefined} />
      ) : (
        <ChatView
          session={session}
          tab={tabs.active}
          tabBar={(
            <TabBar
              tabs={tabs.tabs}
              activeKey={tabs.active?.key ?? null}
              runningKey={session.runningTabKey}
              onSelect={tabs.select}
              onClose={askCloseTab}
            />
          )}
          otherRunningTab={otherRunningTab}
          closedCurrentLayer={closedCurrentLayer}
          onOpenCurrent={tabs.openCurrent}
          onRemoveTab={askCloseTab}
          mcpStatus={status}
          mcpError={error ?? undefined}
          onRetryMcp={retry}
          readOnly={host.readOnly}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
};

const ForgePlugin: React.FC<{ api: ArchonPluginAPI }> = ({ api }) => (
  <I18nProvider api={api}>
    <ForgeApp api={api} />
  </I18nProvider>
);

export default ForgePlugin;
