import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'apps/web',
  plugins: [
    react(),
    cloudflare({
      configPath: '../../wrangler.jsonc',
      persistState: { path: fileURLToPath(new URL('../../.wrangler/state', import.meta.url)) },
    }),
  ],
  build: { outDir: '../../dist', emptyOutDir: true },
});
