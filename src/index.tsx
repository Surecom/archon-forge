import React from 'react';
import ReactDOM from 'react-dom/client';
import ForgePlugin from './ForgePlugin';
import type { ArchonPluginAPI } from './types';
import { disposeArchonMcpWorker } from './mcp/workerLoader';
import './styles/forge.css';

declare global {
  interface Window {
    __archon_register_plugin: (plugin: unknown) => void;
  }
  const __PLUGIN_VERSION__: string;
}

let root: ReactDOM.Root | null = null;

const unmount = () => {
  root?.unmount();
  root = null;
};

window.__archon_register_plugin({
  id: 'archon-forge',
  name: 'Archon Forge',
  version: typeof __PLUGIN_VERSION__ !== 'undefined' ? __PLUGIN_VERSION__ : '0.0.0',
  icon: 'Wand2',
  displayMode: 'floating',
  defaultWindow: { width: 440, height: 640, minWidth: 360, minHeight: 360 },

  activate(_api: ArchonPluginAPI) {
    // The worker boots lazily from render() once settings are valid.
  },

  deactivate() {
    unmount();
    disposeArchonMcpWorker();
  },

  render(api: ArchonPluginAPI, container: HTMLElement) {
    unmount();
    root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <ForgePlugin api={api} />
      </React.StrictMode>,
    );
  },
});
