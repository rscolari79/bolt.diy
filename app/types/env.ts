/**
 * Server-side environment variables as a plain record.
 *
 * Lives outside `.server/` on purpose: `app/lib/modules/llm/types.ts` uses this
 * type and is imported by client components (BaseChat, ModelSelector). A type
 * from a `.server` directory would trip Remix's server-only check.
 */
export type ServerEnv = Record<string, string | undefined>;
