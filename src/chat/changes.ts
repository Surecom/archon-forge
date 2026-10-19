import type { McpOperation } from '../types';

const VISIBILITY_KEYS = new Set(['id', 'visibleElementIds', 'hiddenElementIds']);

/**
 * Operations that only keep the host's bookkeeping in step with another
 * operation of the same batch (layer visibility for a new element, a system's
 * `containerIds` after a container was added) — not a change of their own.
 */
const isBookkeeping = (op: McpOperation): boolean => {
  const payload = (op.payload ?? {}) as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (op.kind === 'updateLayer') return keys.every(k => VISIBILITY_KEYS.has(k));
  if (op.kind === 'updateSystem') return keys.every(k => k === 'id' || k === 'containerIds');
  return false;
};

const targetOf = (op: McpOperation): string => {
  const payload = (op.payload ?? {}) as Record<string, unknown>;
  return String(payload.id ?? payload.elementId ?? payload.scenarioId ?? op.kind);
};

/** Distinct records the user would recognise as changed. */
export function countChanges(ops: McpOperation[]): number {
  const meaningful = ops.filter(op => !isBookkeeping(op));
  const counted = meaningful.length ? meaningful : ops;
  return new Set(counted.map(targetOf)).size;
}
