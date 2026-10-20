import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Shared build for every view. scripts/build-all.ts runs it once per view with
 * that view's folder as the root; the result is one self-contained HTML file
 * (scripts, styles and fonts inlined), as MCP Apps hosts expect.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    reportCompressedSize: false,
    modulePreload: false,
    rollupOptions: {
      onwarn(warning, warn) {
        // zod ships explanatory comments next to its pure annotations; Rollup only drops them.
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
    },
  },
  logLevel: 'warn',
});
