import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@remix-run/express';
import express from 'express';
import { createBasicAuth } from './basic-auth.mjs';

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '0.0.0.0';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const clientDir = path.join(root, 'build', 'client');

const build = await import(path.join(root, 'build', 'server', 'index.js'));

const app = express();

app.disable('x-powered-by');

/*
 * Auth runs first so that assets are protected too. Browsers replay the
 * credentials on every subresource request, so WebContainer previews keep
 * working.
 */
app.use(
  createBasicAuth({
    user: process.env.BOLT_AUTH_USER,
    password: process.env.BOLT_AUTH_PASSWORD,
  }),
);

// Vite fingerprints everything under /assets, so it can be cached indefinitely.
app.use('/assets', express.static(path.join(clientDir, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(clientDir, { maxAge: '1h' }));

/*
 * The real environment has to be handed to the app explicitly. Inside the Vite
 * bundle `process.env` is a static build-time snapshot, because
 * vite-plugin-node-polyfills replaces the process global there. This file is
 * outside the bundle, so here process.env is the running process's own.
 */
app.all(
  '*',
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV ?? 'production',
    getLoadContext: () => ({ env: process.env }),
  }),
);

const server = app.listen(PORT, HOST, () => {
  console.log(`bolt.diy listening on http://${HOST}:${PORT}`);
});

/*
 * Without this, Coolify redeploys wait for the container kill timeout on every
 * deployment instead of shutting down cleanly.
 */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);

    server.close((error) => {
      if (error) {
        console.error(error);
        process.exit(1);
      }

      process.exit(0);
    });
  });
}
