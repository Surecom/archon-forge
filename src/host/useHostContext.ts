import { useEffect, useState } from 'react';
import type { ArchonPluginAPI, ProjectState } from '../types';

export interface LayerSummary {
  id: string;
  name: string;
  color: string;
}

export interface HostContextState {
  /** Scopes tabs and chat history to one project (layer ids repeat across projects, e.g. `default-layer`). */
  projectKey: string;
  selectedLayerId: string | null;
  layers: Record<string, LayerSummary>;
  readOnly: boolean;
  autoLayoutRunning: boolean;
}

/**
 * Drive-backed projects have a stable file id. Local projects only have a
 * name; renaming one starts fresh tabs rather than risk showing another
 * project's history.
 */
export const projectKeyOf = (project: ProjectState): string =>
  typeof project.driveFileId === 'string' && project.driveFileId
    ? `drive:${project.driveFileId}`
    : `local:${project.name ?? ''}`;

const layersOf = (project: ProjectState): Record<string, LayerSummary> =>
  Object.fromEntries(Object.values(project.integrationLayers ?? {}).map(l => [l.id, { id: l.id, name: l.name, color: l.color }]));

const read = (api: ArchonPluginAPI): HostContextState => {
  const project = api.getProjectState();
  const layers = layersOf(project);
  const selected = api.getSelectedLayerId?.() ?? null;
  return {
    projectKey: projectKeyOf(project),
    selectedLayerId: selected && layers[selected] ? selected : null,
    layers,
    readOnly: !!api.getIsViewMode?.(),
    autoLayoutRunning: !!api.getIsAutoLayoutRunning?.(),
  };
};

const sameLayers = (a: Record<string, LayerSummary>, b: Record<string, LayerSummary>): boolean => {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length
    && ids.every(id => b[id] && a[id].name === b[id].name && a[id].color === b[id].color);
};

const sameState = (a: HostContextState, b: HostContextState): boolean =>
  a.projectKey === b.projectKey && a.selectedLayerId === b.selectedLayerId
  && a.readOnly === b.readOnly && a.autoLayoutRunning === b.autoLayoutRunning
  && sameLayers(a.layers, b.layers);

/**
 * Live view of the host state Forge depends on. Every subscription is
 * optional — an older host just reports "no layer, editable". `refresh` lets
 * the window re-read on focus for hosts without change notifications.
 */
export function useHostContext(api: ArchonPluginAPI): HostContextState & { refresh(): void } {
  const [state, setState] = useState<HostContextState>(() => read(api));
  const [refresh] = useState(() => () => setState(prev => {
    const next = read(api);
    return sameState(prev, next) ? prev : next;
  }));

  useEffect(() => {
    const unsubscribers = [
      api.subscribeToSelectedLayer?.(refresh),
      api.subscribeToViewMode?.(refresh),
      api.subscribeToProjectChanges?.(refresh),
      api.subscribeToAutoLayoutRunning?.(refresh),
    ];
    refresh();
    return () => unsubscribers.forEach(unsubscribe => unsubscribe?.());
  }, [api, refresh]);

  return { ...state, refresh };
}
