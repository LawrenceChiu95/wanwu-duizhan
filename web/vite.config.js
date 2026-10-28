import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const rapier = fileURLToPath(new URL('../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url));
// Phone entry goes through the tailnet proxy, which keeps its own Host header.
const allowedHosts = ['lawrence-mac', 'lawrence-mac.tail1c8f33.ts.net'];

export default defineConfig({
  base: './',
  resolve: {alias: {'@dimforge/rapier3d-compat': rapier}},
  server: {fs: {allow: [repo]}, allowedHosts},
  preview: {allowedHosts},
  // Separate chunks so each Artifacts publish batch stays under the upload limit.
  build: {target: 'es2022', chunkSizeWarningLimit: 5000, assetsInlineLimit: 0, rollupOptions: {output: {manualChunks(id) {
    if (id.includes('rapier3d-compat')) return 'rapier';
    if (id.includes('node_modules/three')) return 'three';
  }}}}
});
