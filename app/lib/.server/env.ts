import type { ServerEnv } from '~/types/env';

export type { ServerEnv };

/**
 * The Remix load context, as far as environment access is concerned.
 *
 * `env` is injected by `server/index.mjs` through `getLoadContext`. That file
 * lives OUTSIDE the Vite bundle, which matters: `vite-plugin-node-polyfills`
 * replaces the `process` global in the bundle (the server build imports
 * `vite-plugin-node-polyfills/shims/process`), so `process.env` inside
 * application code is a static build-time snapshot, not the running process's
 * environment. Reading it at runtime silently yields stale or empty values —
 * which is why the upstream project needed Cloudflare bindings to get secrets
 * in at all.
 *
 * `cloudflare.env` is kept so the code stays portable to a Workers deployment
 * without a second abstraction. Under Node it is always absent.
 */
export type ServerEnvContext = {
  env?: unknown;
  cloudflare?: {
    env?: unknown;
  };
};

function toRecord(value: unknown): ServerEnv | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const result: ServerEnv = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined && entry !== null) {
      result[key] = String(entry);
    }
  }

  return result;
}

/**
 * Single source of truth for server-side environment variables.
 *
 * Precedence, lowest to highest: the bundle's `process.env` snapshot, the
 * environment injected by the server entry, then Cloudflare bindings. Later
 * sources are the more specific ones.
 *
 * Never mutates `process.env`.
 */
export function getServerEnv(context?: ServerEnvContext): ServerEnv {
  const injected = toRecord(context?.env);
  const bindings = toRecord(context?.cloudflare?.env);

  if (!injected && !bindings) {
    return process.env as ServerEnv;
  }

  return {
    ...(process.env as ServerEnv),
    ...injected,
    ...bindings,
  };
}
