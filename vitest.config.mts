import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import type { Plugin } from 'vite';

// Plugin que convierte archivos .sql en módulos que exportan su contenido como string
const sqlPlugin: Plugin = {
  name: 'sql-as-string',
  transform(code, id) {
    if (id.endsWith('.sql')) {
      return { code: `export default ${JSON.stringify(code)}` };
    }
  },
};

export default defineWorkersConfig({
  plugins: [sqlPlugin],
  test: {
    poolOptions: {
      workers: {
        // singleWorker: los tests de un mismo archivo comparten el storage D1
        // (necesario para tests de flujo donde un test crea datos que el siguiente lee)
        singleWorker: true,
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
