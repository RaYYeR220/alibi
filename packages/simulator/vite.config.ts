import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The web app: the shell page plus the sign-in callback page. In development
 * /api goes to the local backend (tsx server/local.ts).
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  resolve: {
    alias: {
      '@alibi/host': resolve(__dirname, '../host/src/index.ts'),
      '@alibi/canon': resolve(__dirname, '../canon/src/views.ts'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html'), callback: resolve(__dirname, 'callback.html') },
      onwarn(warning, warn) {
        // zod ships explanatory comments next to its pure annotations; Rollup only drops them.
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
    },
  },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
  logLevel: 'warn',
});
