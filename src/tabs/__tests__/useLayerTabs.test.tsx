// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayerTabs } from '../useLayerTabs';
import type { LayerSummary } from '../../host/useHostContext';

type Host = { projectKey: string; layers: Record<string, LayerSummary>; selectedLayerId: string | null };

const layers: Record<string, LayerSummary> = {
  default: { id: 'default', name: 'Default layer', color: '#3b82f6' },
  payments: { id: 'payments', name: 'Payments flow', color: '#10b981' },
};

const setup = (initial: Host) => renderHook((host: Host) => useLayerTabs(host), { initialProps: initial });

beforeEach(() => localStorage.clear());

describe('useLayerTabs', () => {
  it('opens the current layer on start and a new tab on every switch to an unseen layer', () => {
    const { result, rerender } = setup({ projectKey: 'p', layers, selectedLayerId: 'default' });
    expect(result.current.tabs.map(t => t.layerId)).toEqual(['default']);
    expect(result.current.active?.layerId).toBe('default');

    rerender({ projectKey: 'p', layers, selectedLayerId: 'payments' });
    expect(result.current.tabs.map(t => t.layerId)).toEqual(['default', 'payments']);
    expect(result.current.active?.layerId).toBe('payments');

    rerender({ projectKey: 'p', layers, selectedLayerId: 'default' });
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.active?.layerId).toBe('default');
  });

  it('greys out a tab whose layer was deleted instead of dropping it', () => {
    const { result, rerender } = setup({ projectKey: 'p', layers, selectedLayerId: 'payments' });
    rerender({ projectKey: 'p', layers: { default: layers.default }, selectedLayerId: 'default' });
    const payments = result.current.tabs.find(t => t.layerId === 'payments');
    expect(payments).toMatchObject({ available: false, name: 'Payments flow' });
  });

  it('closing the current layer tab does not reopen it until the user asks', () => {
    const { result, rerender } = setup({ projectKey: 'p', layers, selectedLayerId: 'default' });
    act(() => result.current.close(result.current.active!.key));
    rerender({ projectKey: 'p', layers: { ...layers }, selectedLayerId: 'default' });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.canOpenCurrent).toBe(true);
    act(() => result.current.openCurrent());
    expect(result.current.active?.layerId).toBe('default');
  });

  it('keeps tab sets of different projects apart', () => {
    const { result, rerender } = setup({ projectKey: 'A', layers, selectedLayerId: 'payments' });
    rerender({ projectKey: 'B', layers, selectedLayerId: 'default' });
    expect(result.current.tabs.map(t => t.key)).toEqual(['B::default']);
    rerender({ projectKey: 'A', layers, selectedLayerId: 'payments' });
    expect(result.current.tabs.map(t => t.key)).toEqual(['A::payments']);
  });
});
