import type { ServerEnv } from '~/types/env';

export type { ServerEnv };

/**
 * Shape of the Remix load context when the app runs on Cloudflare.
 * Under the Node runtime this is always absent.
 */
export type MaybeCloudflareContext = {
  cloudflare?: {
    env?: Record<string, unknown>;
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

  if (!bindings) {
    return process.env as ServerEnv;
  }

  const merged: ServerEnv = { ...(process.env as ServerEnv) };

  for (const [key, value] of Object.entries(bindings)) {
    if (value !== undefined && value !== null) {
      merged[key] = String(value);
    }
  }

  return merged;
}
