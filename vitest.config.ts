import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Testes do web usam `// @vitest-environment jsdom` no topo do arquivo.
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./server/types.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'], environment: 'node' },
});
