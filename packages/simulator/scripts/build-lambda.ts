/**
 * Builds the simulator Lambda into dist-lambda/: index.mjs (API, static site
 * and sandbox origin), web/ (the built app) and sandbox.html.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(pkg, 'dist-lambda');

await vite({ configFile: join(pkg, 'vite.config.ts'), root: pkg });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild({
  entryPoints: { index: join(pkg, 'server', 'lambda.ts') },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outdir: out,
  outExtension: { '.js': '.mjs' },
  // The runtime ships these clients; the AgentCore client is newer than the runtime's SDK, so it is bundled.
  external: [
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/client-polly',
    '@aws-sdk/client-ssm',
    '@aws-sdk/lib-dynamodb',
  ],
  banner: { js: "import { createRequire as __simRequire } from 'module'; const require = __simRequire(import.meta.url);" },
  logLevel: 'warning',
});

cpSync(join(pkg, 'dist', 'web'), join(out, 'web'), { recursive: true });
cpSync(join(pkg, 'sandbox', 'sandbox.html'), join(out, 'sandbox.html'));
console.log('dist-lambda ready');
