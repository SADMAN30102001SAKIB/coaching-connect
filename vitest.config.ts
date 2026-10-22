import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { readFileSync, readdirSync } from 'node:fs';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SMS_MODE: 'mock',
          DISPATCH_ENABLED: 'false',
          BOOTSTRAP_TOKEN: 'test-only-bootstrap-key-not-a-real-secret-0001',
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    provide: {
      migration: readdirSync('packages/db/migrations')
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => readFileSync(`packages/db/migrations/${file}`, 'utf8'))
        .join('\n'),
    },
    fileParallelism: false,
  },
});
