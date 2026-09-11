import type { ServerEnv } from '~/types/env';

export type { ServerEnv };

/**
 * Shape of the Remix load context when the app runs on Cloudflare.
 * Under the Node runtime this is always absent.
 *
 * `env` is deliberately `unknown`: Remix types it as the generated `Env`
 * interface, and an interface without an index signature is not assignable to
 * `Record<string, unknown>`. Keeping this boundary loose means the function
 * accepts whatever the host hands it, and the runtime check below decides.
 */
export type MaybeCloudflareContext = {
  cloudflare?: {
    env?: unknown;
  };
};

/**
 * Single source of truth for server-side environment variables.
 *
 * Under Node every variable lives in `process.env`. The optional
 * `cloudflare.env` lookup keeps the code portable to a Workers deployment
 * without introducing a second abstraction; bindings win over `process.env`
 * because they are the more specific source.
 *
 * Never mutates `process.env`.
 */
export function getServerEnv(context?: MaybeCloudflareContext): ServerEnv {
  const bindings = context?.cloudflare?.env;

  if (!bindings || typeof bindings !== 'object') {
    return process.env as ServerEnv;
  }

  const merged: ServerEnv = { ...(process.env as ServerEnv) };

  for (const [key, value] of Object.entries(bindings as Record<string, unknown>)) {
    if (value !== undefined && value !== null) {
      merged[key] = String(value);
    }
  }

  return merged;
}
