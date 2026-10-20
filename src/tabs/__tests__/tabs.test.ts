import { beforeEach, describe, expect, it } from 'vitest';
import { ensureTab, loadTabs, resolveTabs, saveTabs, syncTabs, tabKeyOf } from '../tabs';
import { projectKeyOf } from '../../host/useHostContext';
import type { ProjectState } from '../../types';

const layer = (id: string, name = `Layer ${id}`, color = '#3b82f6') => ({ id, name, color });

beforeEach(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
    clear: () => data.clear(),
    key: i => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
});

describe('layer tabs', () => {
  it('opens a tab per layer and reuses it on a repeated switch', () => {
    let tabs = ensureTab([], layer('default'));
    tabs = ensureTab(tabs, layer('payments'));
    const again = ensureTab(tabs, layer('default'));
    expect(again).toBe(tabs);
    expect(tabs.map(t => t.layerId)).toEqual(['default', 'payments']);
  });

  it('gives every (project, layer) its own key — the history and agent session id', () => {
    expect(tabKeyOf('drive:A', 'default-layer')).not.toBe(tabKeyOf('drive:B', 'default-layer'));
    expect(tabKeyOf('drive:A', 'default-layer')).not.toBe(tabKeyOf('drive:A', 'payments'));
  });

  it('resolves names and colors by layer ID and greys out deleted layers', () => {
    const records = [ensureTab([], layer('a', 'Old name', '#ff0000'))[0], { layerId: 'gone', name: 'Removed', color: '#00ff00' }];
    const tabs = resolveTabs('p', records, { a: layer('a', 'Renamed', '#123456') });
    expect(tabs[0]).toMatchObject({ name: 'Renamed', color: '#123456', available: true });
    expect(tabs[1]).toMatchObject({ name: 'Removed', color: '#00ff00', available: false });
  });

  it('remembers the last name and color so a deleted layer keeps its look', () => {
    const records = ensureTab([], layer('a', 'First', '#111111'));
    const synced = syncTabs(records, { a: layer('a', 'Second', '#222222') });
    expect(synced[0]).toMatchObject({ name: 'Second', color: '#222222' });
    expect(syncTabs(synced, { a: layer('a', 'Second', '#222222') })).toBe(synced);
    expect(syncTabs(synced, {})).toBe(synced);
  });

  it('stores tabs per project', () => {
    saveTabs('drive:A', ensureTab([], layer('x')));
    saveTabs('drive:B', ensureTab([], layer('y')));
    expect(loadTabs('drive:A').map(t => t.layerId)).toEqual(['x']);
    expect(loadTabs('drive:B').map(t => t.layerId)).toEqual(['y']);
    saveTabs('drive:A', []);
    expect(loadTabs('drive:A')).toEqual([]);
  });

  it('keys projects by Drive file id, else by name', () => {
    expect(projectKeyOf({ name: 'Shop', driveFileId: 'f1' } as ProjectState)).toBe('drive:f1');
    expect(projectKeyOf({ name: 'Shop' } as ProjectState)).toBe('local:Shop');
  });
});
