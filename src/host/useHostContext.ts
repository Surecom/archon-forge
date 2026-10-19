import { useEffect, useState } from 'react';
import type { ArchonPluginAPI } from '../types';

export interface HostContextState {
  selectedLayerId: string | null;
  layerName: string | null;
  readOnly: boolean;
  autoLayoutRunning: boolean;
}

const read = (api: ArchonPluginAPI): HostContextState => {
  const selectedLayerId = api.getSelectedLayerId?.() ?? null;
  const layer = selectedLayerId ? api.getProjectState().integrationLayers?.[selectedLayerId] : undefined;
  return {
    selectedLayerId: layer ? selectedLayerId : null,
    layerName: layer?.name ?? null,
    readOnly: !!api.getIsViewMode?.(),
    autoLayoutRunning: !!api.getIsAutoLayoutRunning?.(),
  };
};

const sameState = (a: HostContextState, b: HostContextState): boolean =>
  a.selectedLayerId === b.selectedLayerId && a.layerName === b.layerName
  && a.readOnly === b.readOnly && a.autoLayoutRunning === b.autoLayoutRunning;

/**
 * Live view of the host state Forge depends on. Every subscription is
 * optional — an older host just reports "no layer, editable".
 */
export function useHostContext(api: ArchonPluginAPI): HostContextState {
  const [state, setState] = useState<HostContextState>(() => read(api));

  useEffect(() => {
    const refresh = () => setState(prev => {
      const next = read(api);
      return sameState(prev, next) ? prev : next;
    });
    const unsubscribers = [
      api.subscribeToSelectedLayer?.(refresh),
      api.subscribeToViewMode?.(refresh),
      api.subscribeToProjectChanges?.(refresh),
      api.subscribeToAutoLayoutRunning?.(refresh),
    ];
    refresh();
    return () => unsubscribers.forEach(unsubscribe => unsubscribe?.());
  }, [api]);

  return state;
}
