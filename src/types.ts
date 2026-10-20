/**
 * Local mirror of the host plugin API that Forge uses. The host
 * (draw_c4_tool/client/src/plugins/types.ts) is the canonical source; Forge
 * re-declares the subset it needs so it builds as a standalone repository.
 * Every member newer than the first Forge release is optional — older hosts
 * simply lack the matching capability.
 */

export interface IntegrationLayerSnapshot {
  id: string;
  name: string;
  /** User-chosen layer color — product data, never themed. */
  color: string;
  visibleElementIds: string[];
}

export interface ProjectState {
  name: string;
  /** Ephemeral host field; present for Drive-backed projects. */
  driveFileId?: string;
  systems: Record<string, unknown>;
  containers: Record<string, unknown>;
  users: Record<string, unknown>;
  relationships: Record<string, unknown>;
  groups: Record<string, unknown>;
  integrationLayers: Record<string, IntegrationLayerSnapshot>;
  layerGroups: Record<string, unknown>;
  businessScenarios: Record<string, unknown>;
  scenarioGroups: Record<string, unknown>;
  customColors: string[];
  [key: string]: unknown;
}

/** Opaque to Forge: produced by the archon-mcp worker, applied by the host. */
export interface McpOperation {
  kind: string;
  payload: unknown;
}

export type AutoLayoutEngineId = 'compact-grid' | 'orthogonal-flow';
export type AutoLayoutStatus = 'applied' | 'noop' | 'cancelled' | 'stale' | 'busy' | 'rejected' | 'error';

export interface AutoLayoutRequest {
  engine?: AutoLayoutEngineId;
  layerId?: string | null;
}

export interface AutoLayoutResult {
  status: AutoLayoutStatus;
  reason?: string;
  error?: string;
}

export interface ArchonPluginAPI {
  getProjectState(): ProjectState;
  showNotification(message: string, type: 'info' | 'warning' | 'error' | 'success'): void;
  close(): void;
  /** Applies the batch as ONE undo step (hosts ≥ the MCP_BATCH change). */
  applyMcpOperations(ops: McpOperation[], label?: string): Promise<void>;

  getWindowHeaderContainer?(): HTMLElement | null;
  setWindowMinimized?(minimized: boolean): void;

  getIsViewMode?(): boolean;
  subscribeToViewMode?(cb: () => void): () => void;
  getSelectedLayerId?(): string | null;
  subscribeToSelectedLayer?(cb: () => void): () => void;
  subscribeToProjectChanges?(cb: () => void): () => void;

  runAutoLayout?(request?: AutoLayoutRequest): Promise<AutoLayoutResult>;
  getIsAutoLayoutRunning?(): boolean;
  subscribeToAutoLayoutRunning?(cb: (running: boolean) => void): () => void;

  getThemeId?(): string;
  getThemeMode?(): 'dark' | 'light';
  getLocale?(): 'en' | 'ru';
  subscribeToLocale?(cb: (locale: 'en' | 'ru') => void): () => void;
}
