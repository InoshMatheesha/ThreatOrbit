/**
 * Builds the app for Vercel using the Build Output API (v3):
 *   .vercel/output/static/          the React app (frontend/dist)
 *   .vercel/output/functions/api.func  the Express API bundled into one Node.js function
 *   .vercel/output/config.json      routing (/api/* -> function, SPA fallback) and security headers
 * https://vercel.com/docs/build-output-api/v3
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const fn = path.join(out, 'functions', 'api.func');

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

console.log('Building frontend…');
execSync('npm run build -w frontend', { cwd: root, stdio: 'inherit' });
cpSync(path.join(root, 'frontend', 'dist'), path.join(out, 'static'), { recursive: true });

console.log('Bundling API function…');
await build({
  entryPoints: [path.join(root, 'backend', 'src', 'serverless.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // CommonJS dependencies inside an ES module bundle need these.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
  // Optional MongoDB driver add-ons (Kerberos, field-level encryption, compression, AWS auth)
  // and dev-only fallbacks that the serverless entry never loads.
  external: [
    'kerberos',
    '@mongodb-js/zstd',
    'snappy',
    'mongodb-client-encryption',
    'gcp-metadata',
    '@aws-sdk/credential-providers',
    'socks',
    'aws4',
    'mongodb-memory-server-core',
    'bullmq',
    'ioredis',
  ],
  logLevel: 'warning',
});

writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '/(.*)', headers: securityHeaders, continue: true },
        { src: '^/api(?:/.*)?$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log('Vercel build output ready in .vercel/output');
