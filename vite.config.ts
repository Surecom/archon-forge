import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  define: {
    // Tests need React's development build (it is the one exporting `act`).
    ...(process.env.VITEST ? {} : { 'process.env.NODE_ENV': JSON.stringify('production') }),
    '__PLUGIN_VERSION__': JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.tsx'),
      name: 'ArchonForgePlugin',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: (id) => /^react(-dom)?(\/.*)?$/.test(id),
      output: {
        inlineDynamicImports: true,
        globals: (id: string) => {
          if (id === 'react') return 'React';
          if (id === 'react-dom' || id.startsWith('react-dom/')) return 'ReactDOM';
          if (id.startsWith('react/jsx')) return 'ReactJSXRuntime';
          return 'React';
        },
        assetFileNames: (info) => {
          if (info.name?.endsWith('.css')) return 'style.css';
          return info.name ?? 'asset';
        },
      },
    },
    outDir: 'build',
    cssCodeSplit: false,
  },
});
