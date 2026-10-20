import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostContextState } from '../host/useHostContext';
import { ensureTab, LayerTab, loadTabs, resolveTabs, saveTabs, syncTabs, tabKeyOf, TabRecord } from './tabs';

export interface LayerTabsState {
  tabs: LayerTab[];
  active: LayerTab | null;
  /** The host's current layer has no open tab (the user closed it). */
  canOpenCurrent: boolean;
  select(key: string): void;
  close(key: string): void;
  openCurrent(): void;
}

/** Tab records are always stored together with the project they belong to. */
interface ProjectTabs {
  projectKey: string;
  records: TabRecord[];
  activeLayerId: string | null;
}

/**
 * Tabs follow the host's layer selection: opening Forge, or switching to a
 * layer while it is open, activates that layer's tab — creating it on first
 * visit. Clicking a tab only changes what Forge shows; the chat in a tab
 * always edits that tab's layer.
 */
export function useLayerTabs(host: Pick<HostContextState, 'projectKey' | 'layers' | 'selectedLayerId'> & { themeMode?: HostContextState['themeMode'] }): LayerTabsState {
  const { projectKey, layers, selectedLayerId, themeMode } = host;
  const [state, setState] = useState<ProjectTabs>(() => ({ projectKey, records: loadTabs(projectKey), activeLayerId: null }));

  /** Every update starts from this project's tabs, even mid project switch. */
  const update = useCallback((fn: (s: ProjectTabs) => Partial<ProjectTabs>) => {
    setState(prev => {
      const base = prev.projectKey === projectKey ? prev : { projectKey, records: loadTabs(projectKey), activeLayerId: null };
      return { ...base, ...fn(base) };
    });
  }, [projectKey]);

  // Follow the host selection — on open, on every switch, and in a newly opened project.
  useEffect(() => {
    const layer = selectedLayerId ? layers[selectedLayerId] : undefined;
    if (!layer) {
      update(() => ({}));
      return;
    }
    update(s => ({ records: ensureTab(s.records, layer), activeLayerId: layer.id }));
    // Only a selection or project change opens a tab — not a rename of the same layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId, projectKey, update]);

  useEffect(() => { update(s => ({ records: syncTabs(s.records, layers) })); }, [layers, update]);

  useEffect(() => { saveTabs(state.projectKey, state.records); }, [state.projectKey, state.records]);

  const current = state.projectKey === projectKey ? state : { projectKey, records: loadTabs(projectKey), activeLayerId: null };
  const tabs = useMemo(() => resolveTabs(projectKey, current.records, layers, themeMode), [projectKey, current.records, layers, themeMode]);
  const active = tabs.find(t => t.layerId === current.activeLayerId) ?? tabs[0] ?? null;

  const select = useCallback((key: string) => {
    update(s => {
      const record = s.records.find(r => tabKeyOf(projectKey, r.layerId) === key);
      return record ? { activeLayerId: record.layerId } : {};
    });
  }, [projectKey, update]);

  const close = useCallback((key: string) => {
    update(s => {
      const index = s.records.findIndex(r => tabKeyOf(projectKey, r.layerId) === key);
      if (index < 0) return {};
      const records = s.records.filter((_, i) => i !== index);
      const activeLayerId = s.records[index].layerId === s.activeLayerId
        ? records[Math.min(index, records.length - 1)]?.layerId ?? null
        : s.activeLayerId;
      return { records, activeLayerId };
    });
  }, [projectKey, update]);

  const openCurrent = useCallback(() => {
    const layer = selectedLayerId ? layers[selectedLayerId] : undefined;
    if (layer) update(s => ({ records: ensureTab(s.records, layer), activeLayerId: layer.id }));
  }, [layers, selectedLayerId, update]);

  const canOpenCurrent = !!selectedLayerId && !!layers[selectedLayerId]
    && !current.records.some(r => r.layerId === selectedLayerId);

  return { tabs, active, canOpenCurrent, select, close, openCurrent };
}
