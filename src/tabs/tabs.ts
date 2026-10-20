/**
 * Layer tabs — one chat per (project, integration layer).
 *
 * A tab is bound to a layer ID. Its key doubles as the chat-history session
 * id and the provider-session key, so two tabs never share a transcript or an
 * agent conversation. Names and colors are resolved from the live project by
 * ID; the stored copy is only a fallback for tabs whose layer was deleted.
 *
 * Tabs are per user and per browser (`localStorage`), never in the project.
 */
import type { LayerSummary } from '../host/useHostContext';

export interface TabRecord {
  layerId: string;
  /** Last seen name/color — shown when the layer no longer exists. */
  name: string;
  color: string;
}

export interface LayerTab extends TabRecord {
  key: string;
  /** False when the layer was deleted from the project: read-only history. */
  available: boolean;
}

const STORAGE_KEY = 'archon-forge.tabs';
const FALLBACK_COLOR = '#64748b';

export const tabKeyOf = (projectKey: string, layerId: string): string => `${projectKey}::${layerId}`;

type TabStore = Record<string, TabRecord[]>;

function readStore(): TabStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as TabStore : {};
  } catch {
    return {};
  }
}

export const loadTabs = (projectKey: string): TabRecord[] =>
  (readStore()[projectKey] ?? []).filter(t => t && typeof t.layerId === 'string');

export function saveTabs(projectKey: string, tabs: TabRecord[]): void {
  try {
    const store = readStore();
    if (tabs.length) store[projectKey] = tabs;
    else delete store[projectKey];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* storage unavailable — tabs live for this session only */ }
}

/** Adds the layer's tab if missing; returns the same array when nothing changed. */
export function ensureTab(tabs: TabRecord[], layer: LayerSummary): TabRecord[] {
  return tabs.some(t => t.layerId === layer.id)
    ? tabs
    : [...tabs, { layerId: layer.id, name: layer.name, color: layer.color || FALLBACK_COLOR }];
}

/** Refreshes stored names/colors from the project so a later deletion keeps the last known look. */
export function syncTabs(tabs: TabRecord[], layers: Record<string, LayerSummary>): TabRecord[] {
  let changed = false;
  const next = tabs.map(t => {
    const layer = layers[t.layerId];
    if (!layer || (layer.name === t.name && (layer.color || FALLBACK_COLOR) === t.color)) return t;
    changed = true;
    return { ...t, name: layer.name, color: layer.color || FALLBACK_COLOR };
  });
  return changed ? next : tabs;
}

export const resolveTabs = (projectKey: string, tabs: TabRecord[], layers: Record<string, LayerSummary>): LayerTab[] =>
  tabs.map(t => {
    const layer = layers[t.layerId];
    return {
      key: tabKeyOf(projectKey, t.layerId),
      layerId: t.layerId,
      name: layer?.name ?? t.name,
      color: layer?.color || t.color || FALLBACK_COLOR,
      available: !!layer,
    };
  });
