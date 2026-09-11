# Phase 1: Node-Runtime und Coolify-Härtung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bolt.diy läuft in Produktion als normaler Node-Prozess hinter einem expliziten Express-Server statt über `wrangler pages dev`, mit Environment aus `process.env`, Basic-Auth und einem schlanken Docker-Image, das auf Coolify zuverlässig startet.

**Architecture:** Ein neuer Server-Entry `server/index.mjs` (Express 4 + `@remix-run/express`) lädt den unveränderten Remix-SSR-Build und serviert ihn. Die gesamte Cloudflare-Worker-Schicht (`wrangler pages dev`, `bindings.sh`, `functions/[[path]].ts`, `worker-configuration.d.ts`) entfällt. Environment-Zugriffe laufen über eine einzige Funktion `getServerEnv()`, die `process.env` als Quelle nutzt. Das Dockerfile wird in vier Stages getrennt, sodass das Runtime-Image keinen Source-Tree mehr enthält.

**Tech Stack:** Node 22, Express 4.22.2, `@remix-run/express` 2.16.8, Remix 2.16.8 (unverändert), Vite 5.4 (unverändert), React 18.3 (unverändert), pnpm, Vitest 2.1, Docker.

**Spec:** `docs/superpowers/specs/2026-09-11-bolt-coolify-modernisierung-design.md`

## Global Constraints

- **Keine Dependency-Majors in dieser Phase.** React bleibt 18.3, Remix bleibt 2.16.8, Vite bleibt 5.4, AI SDK bleibt 4.3. Einzige Neuzugänge: `express@4.22.2` und `@remix-run/express@2.16.8` (exakt gepinnt, damit die `@remix-run/*`-Familie konsistent bei 2.16.8 bleibt).
- **Remix-Version exakt pinnen:** `@remix-run/express` MUSS als `"2.16.8"` ohne Caret eingetragen werden. Ein `^2.15.2` würde auf 2.17.5 auflösen und die Familie spalten.
- **`typecheck` ist die primäre Absicherung.** Es existieren nur 3 Testdateien für ~70.000 Zeilen Code. Jede Task endet mit grünem `pnpm typecheck`.
- **Baseline-Fehler:** `pnpm typecheck` meldet im Ausgangszustand genau einen Fehler: `functions/[[path]].ts(5,37): error TS2307: Cannot find module '../build/server'`. Dieser verschwindet in Task 3 mit dem Löschen der Datei. Danach MUSS `typecheck` fehlerfrei sein.
- **COOP/COEP nicht anfassen.** `app/entry.server.tsx` setzt `Cross-Origin-Embedder-Policy: require-corp` und `Cross-Origin-Opener-Policy: same-origin`. WebContainer benötigt beide. Verifiziert: sie überleben den Express-Pfad.
- **Port und Host:** Der Server liest `process.env.PORT ?? 5173` und `process.env.HOST ?? '0.0.0.0'`.
- **Kein `compression`-Middleware.** Der Chat streamt per SSE; Kompression davor ist eine bekannte Fehlerquelle und bringt für gestreamte Antworten nichts.
- **Typ `ServerEnv` liegt in `app/types/env.ts`, nicht in `.server/`.** `app/lib/modules/llm/types.ts` wird von Client-Komponenten (`BaseChat.tsx`, `ModelSelector.tsx`) importiert; ein Typ aus einem `.server`-Verzeichnis würde Remix' Server-Only-Prüfung auslösen.
- **Commit-Sprache:** Conventional Commits, Beschreibung auf Deutsch, jeweils mit der Zeile `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Nicht pushen.** Diese Phase wird vollständig lokal implementiert und verifiziert. Der GitHub-Zugang wird erst nach Task 9 eingerichtet.
- **Bewusste Abweichung vom Spec:** Abschnitt 7.3 des Specs nennt „pnpm 9.14.4 → 10". Dieser Plan belässt pnpm bei **9.14.4**. Grund: `package.json` schreibt die Version über `packageManager` fest, und ein pnpm-Major schreibt den Lockfile neu — das vermischt sich mit der Runtime-Umstellung und widerspricht dem Grundsatz „keine Dependency-Majors in Phase 1". Der Sprung gehört in Phase 2, wo der Lockfile ohnehin neu entsteht. Node wird wie im Spec vorgesehen auf 22 gehoben, damit CI dieselbe Runtime prüft wie Produktion.

## Verifizierte Vorarbeit

Diese Annahmen wurden vor dem Schreiben dieses Plans empirisch geprüft und müssen nicht erneut untersucht werden:

- **Express serviert den bestehenden Build.** Ein Spike mit `createRequestHandler` aus `@remix-run/express` gegen den unveränderten `build/server/index.js` lieferte `/api/health` → 200 und `/` → 200 mit vollständigem SSR-HTML (4391 Bytes), inklusive `remix-island`-Head und allen 22 registrierten LLM-Providern. Es sind **keine** weiteren Anpassungen am Remix-Build nötig.
- **`react-dom/server` ist unter Node kaputt.** `node -e "import('react-dom/server')…"` ergibt `renderToReadableStream: undefined`; `react-dom/server.browser` ergibt `function`. Ohne den Import-Wechsel schlägt der Serverstart mit `SyntaxError: Named export 'renderToReadableStream' not found` fehl.
- **`@types/react-dom` hat keinen `./server.browser`-Export** (nur `.`, `./canary`, `./client`, `./server`, `./experimental`, `./test-utils`). Der Import-Wechsel erfordert daher zwingend die Ambient-Deklaration aus Task 3. Mit ihr läuft `tsc` fehlerfrei durch — verifiziert.
- **Vitest erfasst `.mjs`-Testdateien.** Default-`include` ist `**/*.{test,spec}.?(c|m)[jt]s?(x)`; `server/basic-auth.spec.mjs` wird gefunden.
- **`types/` existiert bereits** (enthält `types/istextorbinary.d.ts`) und wird von `tsconfig.include` (`**/*.ts`) erfasst.
- **`express@4.22.2` und `@remix-run/express@2.16.8` liegen bereits in `node_modules`** (vom Spike). `pnpm add` in Task 5 ist dadurch schnell.

## File Structure

**Neu:**

| Datei | Verantwortung |
|---|---|
| `app/types/env.ts` | Der Typ `ServerEnv`. Client-importierbar, weil nur ein Typ. |
| `app/lib/.server/env.ts` | Die Funktion `getServerEnv()`. Einzige Quelle für Server-Environment. |
| `app/lib/.server/env.spec.ts` | Tests für die Auflösungsreihenfolge. |
| `types/react-dom-server-browser.d.ts` | Ambient-Deklaration für `react-dom/server.browser`. |
| `server/basic-auth.mjs` | HTTP-Basic-Auth als Express-Middleware. Reine Logik, keine Server-Kenntnis. |
| `server/basic-auth.spec.mjs` | Tests für die Middleware. |
| `server/index.mjs` | Server-Entry: Express, Static-Serving, Auth-Verdrahtung, Signal-Handling. |

**Geändert:** `app/entry.server.tsx`, `vite.config.ts`, `tsconfig.json`, `package.json`, `.dockerignore`, `.gitignore`, `Dockerfile`, `docker-compose.yaml`, `app/routes/api.chat.ts`, `api.enhancer.ts`, `api.models.ts`, `api.llmcall.ts`, `app/lib/modules/llm/types.ts`, `base-provider.ts`, 21 Provider-Dateien, `app/lib/.server/llm/{stream-text,select-context,create-summary}.ts`, `app/lib/common/prompts/prompts.ts`, 39 Dateien mit `@remix-run/cloudflare`-Import, `.github/actions/setup-and-build/action.yaml`, `.github/workflows/ci.yaml`, `README.md`.

**Gelöscht:** `bindings.sh`, `worker-configuration.d.ts`, `wrangler.toml`, `functions/[[path]].ts`, `functions/`, `load-context.ts`, `electron/`, `electron-builder.yml`, `electron-update.yml`, `notarize.cjs`, `vite-electron.config.js`, `.github/workflows/electron.yml`.

---

### Task 0: Branch anlegen

**Files:** keine.

**Interfaces:**
- Consumes: nichts.
- Produces: den Branch `feat/node-runtime-coolify`, auf dem alle folgenden Commits landen.

- [ ] **Step 1: Ausgangszustand prüfen**

```bash
cd /Users/ros/Documents/Claude/Bolt
git status --short
git log --oneline -1
```
Expected: leerer Arbeitsbaum; HEAD ist der Design-Commit (`docs: Design für Coolify-Optimierung und Modernisierung`).
Falls der Arbeitsbaum nicht leer ist: **nicht** blind aufräumen, sondern die Änderungen zeigen und nachfragen.

- [ ] **Step 2: Branch anlegen**

```bash
git switch -c feat/node-runtime-coolify
git branch --show-current
```
Expected: `feat/node-runtime-coolify`

- [ ] **Step 3: Baseline festhalten**

```bash
pnpm typecheck 2>&1 | tail -3
```
Expected: genau ein Fehler, `functions/[[path]].ts(5,37): error TS2307`. Dieser Wert ist der Vergleichspunkt für alle folgenden Tasks — nach Task 3 muss er verschwunden sein.

---

### Task 1: Env-Abstraktion einführen

Legt `ServerEnv` und `getServerEnv()` an — die einzige Quelle für Server-Environment. Noch ohne Umstellung der Aufrufstellen, damit dieser Baustein isoliert prüfbar ist.

**Files:**
- Create: `app/types/env.ts`
- Create: `app/lib/.server/env.ts`
- Test: `app/lib/.server/env.spec.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `type ServerEnv = Record<string, string | undefined>` aus `~/types/env`
  - `type MaybeCloudflareContext = { cloudflare?: { env?: Record<string, unknown> } }` aus `~/lib/.server/env`
  - `function getServerEnv(context?: MaybeCloudflareContext): ServerEnv` aus `~/lib/.server/env`

- [ ] **Step 1: Den Typ anlegen**

`app/types/env.ts`:

```ts
/**
 * Server-side environment variables as a plain record.
 *
 * Lives outside `.server/` on purpose: `app/lib/modules/llm/types.ts` uses this
 * type and is imported by client components (BaseChat, ModelSelector). A type
 * from a `.server` directory would trip Remix's server-only check.
 */
export type ServerEnv = Record<string, string | undefined>;
```

- [ ] **Step 2: Den failing test schreiben**

`app/lib/.server/env.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getServerEnv } from './env';

describe('getServerEnv', () => {
  afterEach(() => {
    delete process.env.BOLT_TEST_KEY;
  });

  it('reads variables from process.env when no context is given', () => {
    process.env.BOLT_TEST_KEY = 'from-process';
    expect(getServerEnv().BOLT_TEST_KEY).toBe('from-process');
  });

  it('reads from process.env when the context carries no cloudflare bindings', () => {
    process.env.BOLT_TEST_KEY = 'from-process';
    expect(getServerEnv({}).BOLT_TEST_KEY).toBe('from-process');
  });

  it('lets cloudflare bindings take precedence over process.env', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: 'from-binding' } } });

    expect(env.BOLT_TEST_KEY).toBe('from-binding');
  });

  it('keeps process.env values the bindings do not override', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ cloudflare: { env: { SOMETHING_ELSE: 'x' } } });

    expect(env.BOLT_TEST_KEY).toBe('from-process');
  });

  it('coerces non-string binding values to strings', () => {
    const env = getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: 42 } } });

    expect(env.BOLT_TEST_KEY).toBe('42');
  });

  it('skips null and undefined binding values', () => {
    process.env.BOLT_TEST_KEY = 'from-process';

    const env = getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: null } } });

    expect(env.BOLT_TEST_KEY).toBe('from-process');
  });

  it('does not mutate process.env when merging bindings', () => {
    getServerEnv({ cloudflare: { env: { BOLT_TEST_KEY: 'from-binding' } } });

    expect(process.env.BOLT_TEST_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 3: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm vitest --run app/lib/.server/env.spec.ts`
Expected: FAIL — `Failed to resolve import "./env"` bzw. `Cannot find module './env'`

- [ ] **Step 4: Die Implementierung schreiben**

`app/lib/.server/env.ts`:

```ts
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
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `pnpm vitest --run app/lib/.server/env.spec.ts`
Expected: PASS — 7 passed

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: nur der bekannte Baseline-Fehler `functions/[[path]].ts(5,37)`

- [ ] **Step 7: Commit**

```bash
git add app/types/env.ts app/lib/.server/env.ts app/lib/.server/env.spec.ts
git commit -m "$(cat <<'MSG'
feat: Env-Abstraktion getServerEnv als einzige Quelle für Server-Environment

Ersetzt die bisherige Zweiteilung aus context.cloudflare.env und direkten
process.env-Zugriffen durch eine Funktion. Cloudflare-Bindings behalten
Vorrang, damit der Code portierbar bleibt, ohne gepflegt werden zu müssen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Env-Aufrufstellen und Env-Typ umstellen

Ersetzt die 11 `context.cloudflare?.env`-Zugriffe durch `getServerEnv(context)` und die 28 Referenzen auf den ambienten Typ `Env` durch `ServerEnv`. Danach hängt kein Code mehr an `worker-configuration.d.ts`.

**Files:**
- Modify: `app/routes/api.chat.ts:123,165,271,312`
- Modify: `app/routes/api.enhancer.ts:80`
- Modify: `app/routes/api.models.ts:54,73,81`
- Modify: `app/routes/api.llmcall.ts:109,154,199`
- Modify: `app/lib/modules/llm/types.ts:26`
- Modify: `app/lib/modules/llm/base-provider.ts:28` (2 Referenzen)
- Modify: `app/lib/modules/llm/providers/*.ts` (21 Dateien)
- Modify: `app/lib/.server/llm/stream-text.ts:56`, `select-context.ts:17`, `create-summary.ts:12`
- Modify: `app/lib/common/prompts/prompts.ts`

**Interfaces:**
- Consumes: `getServerEnv`, `ServerEnv` aus Task 1.
- Produces: keine neuen Symbole. Nach dieser Task existiert keine Referenz auf den globalen Typ `Env` mehr.

- [ ] **Step 1: Die 28 Env-Typ-Referenzen auf ServerEnv umstellen**

Der globale Typ `Env` erscheint ausschliesslich in diesen vier Formen: `serverEnv: Env`, `serverEnv?: Env`, `env: Env`, `env?: Env`. Codemod:

```bash
cd /Users/ros/Documents/Claude/Bolt
FILES=$(grep -rl "serverEnv: Env\|serverEnv?: Env\|env?: Env\|env: Env" app/)
echo "$FILES" | tr ' ' '\n' | sort -u
for f in $FILES; do
  sed -i '' \
    -e 's/serverEnv: Env\b/serverEnv: ServerEnv/g' \
    -e 's/serverEnv?: Env\b/serverEnv?: ServerEnv/g' \
    -e 's/\benv: Env\b/env: ServerEnv/g' \
    -e 's/\benv?: Env\b/env?: ServerEnv/g' \
    "$f"
done
grep -rn "serverEnv: Env\|serverEnv?: Env\|env?: Env\|env: Env" app/ || echo "keine Env-Referenz mehr"
```

- [ ] **Step 2: Den Import von ServerEnv in jeder betroffenen Datei ergänzen**

Jede der Dateien aus Step 1 braucht `import type { ServerEnv } from '~/types/env';`. Die Provider-Dateien haben alle dieselbe Import-Struktur; als Anker dient die bestehende `IProviderSetting`-Zeile:

```bash
cd /Users/ros/Documents/Claude/Bolt
for f in $(grep -rl "ServerEnv" app/lib/modules/llm/providers/); do
  grep -q "from '~/types/env'" "$f" || sed -i '' \
    "s|import type { IProviderSetting } from '~/types/model';|import type { IProviderSetting } from '~/types/model';\nimport type { ServerEnv } from '~/types/env';|" "$f"
done
```

Für `types.ts`, `base-provider.ts`, die drei `.server/llm`-Module und `prompts.ts` den Import von Hand als erste `import type`-Zeile ergänzen. `pnpm typecheck` in Step 5 meldet jede vergessene Datei mit `TS2304: Cannot find name 'ServerEnv'`.

Worked example — `app/lib/modules/llm/providers/anthropic.ts`, Kopf danach:

```ts
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { LanguageModelV1 } from 'ai';
import type { IProviderSetting } from '~/types/model';
import type { ServerEnv } from '~/types/env';
import { createAnthropic } from '@ai-sdk/anthropic';
```

- [ ] **Step 3: `convertEnvToRecord` in base-provider.ts anpassen**

`app/lib/modules/llm/base-provider.ts` — der Kommentar beschreibt jetzt die falsche Welt, und die Signatur nutzt `ServerEnv`:

```ts
  /**
   * Normalise a ServerEnv into a plain Record<string, string>.
   *
   * Provider methods expect string values; ServerEnv allows undefined because
   * process.env does. Undefined entries are dropped rather than stringified.
   */
  protected convertEnvToRecord(env?: ServerEnv): Record<string, string> {
    if (!env) {
      return {};
    }

    return Object.entries(env).reduce(
      (acc, [key, value]) => {
        if (value !== undefined) {
          acc[key] = String(value);
        }

        return acc;
      },
      {} as Record<string, string>,
    );
  }
```

- [ ] **Step 4: Die 11 context.cloudflare-Aufrufstellen umstellen**

In `api.chat.ts`, `api.enhancer.ts`, `api.models.ts` und `api.llmcall.ts` jeweils den Import ergänzen:

```ts
import { getServerEnv } from '~/lib/.server/env';
```

Dann die Aufrufstellen ersetzen. `context.cloudflare?.env` wird zu `getServerEnv(context)`, und die `as any`-Krücken entfallen, weil der Typ jetzt passt:

```bash
cd /Users/ros/Documents/Claude/Bolt
sed -i '' \
  -e 's/context\.cloudflare?\.env as any/getServerEnv(context)/g' \
  -e 's/context\.cloudflare?\.env/getServerEnv(context)/g' \
  app/routes/api.chat.ts app/routes/api.enhancer.ts app/routes/api.models.ts app/routes/api.llmcall.ts
grep -rn "context.cloudflare" app/ || echo "keine cloudflare-Zugriffe mehr"
```

Erwartete Ergebnisse, exemplarisch:

```ts
// app/routes/api.models.ts:54
const llmManager = LLMManager.getInstance(getServerEnv(context));

// app/routes/api.chat.ts:123
            env: getServerEnv(context),

// app/routes/api.llmcall.ts:154
      const models = await getModelList({ apiKeys, providerSettings, serverEnv: getServerEnv(context) });
```

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: nur der bekannte Baseline-Fehler `functions/[[path]].ts(5,37)`.
Falls `TS2304: Cannot find name 'ServerEnv'` erscheint: in der genannten Datei den Import aus Step 2 ergänzen.
Falls `LLMManager.getInstance` einen Typfehler meldet: `getInstance(env: Record<string, string> = {})` in `app/lib/modules/llm/manager.ts` auf `env: ServerEnv = {}` anpassen und `_env` gleich mitziehen.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm test`
Expected: PASS — die 3 bestehenden Specs plus die 7 aus Task 1.

- [ ] **Step 7: Build laufen lassen**

Run: `pnpm run build`
Expected: `✓ built in …`, `build/server/index.js` vorhanden.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
refactor: Env-Zugriffe auf getServerEnv und ServerEnv umstellen

Ersetzt 11 context.cloudflare.env-Zugriffe und 28 Referenzen auf den
ambienten Typ Env aus worker-configuration.d.ts. Die as-any-Krücken an den
Aufrufstellen entfallen, weil der Typ jetzt passt. Danach hängt kein Code
mehr an der Cloudflare-Typdeklaration.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Node-Adapter-Wechsel und Cloudflare-Schicht entfernen

Stellt 39 Dateien von `@remix-run/cloudflare` auf `@remix-run/node` um, behebt den `renderToReadableStream`-Defekt, entfernt den Cloudflare-Dev-Proxy aus der Vite-Config und löscht die Worker-Dateien. Nach dieser Task ist `typecheck` erstmals vollständig fehlerfrei.

**Files:**
- Create: `types/react-dom-server-browser.d.ts`
- Modify: `app/entry.server.tsx:1,4`
- Modify: `vite.config.ts:1,46`
- Modify: `tsconfig.json` (`types`-Array)
- Modify: 39 Dateien mit `@remix-run/cloudflare`-Import
- Delete: `functions/[[path]].ts`, `functions/`, `load-context.ts`, `wrangler.toml`, `worker-configuration.d.ts`, `bindings.sh`

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces: `declare module 'react-dom/server.browser'` — ohne diese Deklaration schlägt `tsc` mit `TS2307` fehl.

- [ ] **Step 1: Die Ambient-Deklaration anlegen**

`types/react-dom-server-browser.d.ts`:

```ts
/**
 * @types/react-dom 18 exposes only `./server` in its exports map, but at runtime
 * under Node `react-dom/server` resolves to server.node.js, which does NOT export
 * renderToReadableStream. The browser entry does, and works in Node 22 because
 * Web Streams are global there. This declaration gives the browser entry the
 * same types as `react-dom/server`.
 */
declare module 'react-dom/server.browser' {
  export * from 'react-dom/server';
}
```

- [ ] **Step 2: entry.server.tsx korrigieren**

```bash
cd /Users/ros/Documents/Claude/Bolt
sed -i '' \
  -e "s|import type { AppLoadContext } from '@remix-run/cloudflare';|import type { AppLoadContext } from '@remix-run/node';|" \
  -e "s|import { renderToReadableStream } from 'react-dom/server';|import { renderToReadableStream } from 'react-dom/server.browser';|" \
  app/entry.server.tsx
head -6 app/entry.server.tsx
```

Erwartet:

```tsx
import type { AppLoadContext } from '@remix-run/node';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import { renderToReadableStream } from 'react-dom/server.browser';
```

- [ ] **Step 3: Die restlichen 38 Dateien umstellen**

Alle Importe sind reine Umbenennungen — `json`, `AppLoadContext`, `ActionFunction`, `ActionFunctionArgs`, `LoaderFunction`, `LoaderFunctionArgs`, `MetaFunction`, `LinksFunction` existieren in `@remix-run/node` identisch:

```bash
cd /Users/ros/Documents/Claude/Bolt
grep -rl "@remix-run/cloudflare" app/ | while read -r f; do
  sed -i '' "s|'@remix-run/cloudflare'|'@remix-run/node'|g" "$f"
done
grep -rn "@remix-run/cloudflare" app/ || echo "keine cloudflare-Importe mehr in app/"
```

- [ ] **Step 4: Den Cloudflare-Dev-Proxy aus vite.config.ts entfernen**

Zeile 1 und Zeile 46 ändern. Danach entfällt auch der `sed`-Hack im Dockerfile (Task 7).

```bash
cd /Users/ros/Documents/Claude/Bolt
sed -i '' \
  -e "s|import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from '@remix-run/dev';|import { vitePlugin as remixVitePlugin } from '@remix-run/dev';|" \
  -e "/config\.mode !== 'test' \&\& remixCloudflareDevProxy(),/d" \
  vite.config.ts
head -8 vite.config.ts; grep -n "remixCloudflareDevProxy" vite.config.ts || echo "Proxy entfernt"
```

- [ ] **Step 5: tsconfig.json anpassen**

Das `types`-Array verweist auf Cloudflare und Electron. Beide entfallen. Neu:

```json
    "types": [
      "@remix-run/node",
      "vite/client",
      "@types/dom-speech-recognition"
    ],
```

- [ ] **Step 6: Die Worker-Dateien löschen**

```bash
cd /Users/ros/Documents/Claude/Bolt
git rm -r --quiet functions load-context.ts wrangler.toml worker-configuration.d.ts bindings.sh
ls functions load-context.ts wrangler.toml worker-configuration.d.ts bindings.sh 2>&1 | head -3
```

- [ ] **Step 7: typecheck — jetzt muss er vollständig grün sein**

Run: `pnpm typecheck`
Expected: **keine Ausgabe, Exit 0.** Der Baseline-Fehler `functions/[[path]].ts(5,37)` ist mit der Datei verschwunden.
Falls `TS2307: Cannot find module 'react-dom/server.browser'` erscheint: `types/react-dom-server-browser.d.ts` aus Step 1 fehlt oder liegt nicht unter `types/`.
Falls Fehler zu fehlenden Worker-Globals (`KVNamespace`, `PagesFunction` o. Ä.) erscheinen: die betroffene Stelle nennt Code, der übersehen wurde — im Design ist belegt, dass es keinen solchen Code gibt, also genau hinsehen.

- [ ] **Step 8: Build laufen lassen und den Import im Artefakt prüfen**

Run: `pnpm run build`
Expected: `✓ built in …`

```bash
grep -o "from 'react-dom/server[^']*'" build/server/assets/server-build-*.js | head -2
```
Expected: `from 'react-dom/server.browser'`

- [ ] **Step 9: Tests laufen lassen**

Run: `pnpm test`
Expected: PASS — 10 Tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
refactor: von Cloudflare-Workers- auf Node-Adapter wechseln

Stellt 39 Dateien von @remix-run/cloudflare auf @remix-run/node um und
korrigiert entry.server.tsx auf react-dom/server.browser: der Node-Build von
react-dom/server exportiert renderToReadableStream nicht, der Serverstart
scheiterte daher mit einem SyntaxError.

Entfernt den Cloudflare-Dev-Proxy aus der Vite-Config, wodurch der
sed-Workaround im Dockerfile entbehrlich wird, sowie functions/,
load-context.ts, wrangler.toml, worker-configuration.d.ts und bindings.sh.

typecheck ist damit erstmals vollständig fehlerfrei.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Basic-Auth-Middleware

Eigenständiges Modul, damit es ohne laufenden Server testbar ist. Wird in Task 5 verdrahtet.

**Files:**
- Create: `server/basic-auth.mjs`
- Test: `server/basic-auth.spec.mjs`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `function parseBasicAuth(header: string | undefined): { user: string, password: string } | undefined`
  - `function createBasicAuth({ user, password, publicPaths }): (req, res, next) => void` — gibt eine Durchlass-Middleware zurück, wenn `user` oder `password` fehlt. `publicPaths` hat den Default `['/api/health']`.

- [ ] **Step 1: Den failing test schreiben**

`server/basic-auth.spec.mjs`:

```js
import { describe, expect, it, vi } from 'vitest';
import { createBasicAuth, parseBasicAuth } from './basic-auth.mjs';

function makeReq(urlPath, authorization) {
  return { path: urlPath, headers: authorization ? { authorization } : {} };
}

function makeRes() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

const encode = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('parseBasicAuth', () => {
  it('decodes a well-formed header', () => {
    expect(parseBasicAuth(encode('ada', 'hunter2'))).toEqual({ user: 'ada', password: 'hunter2' });
  });

  it('keeps colons inside the password', () => {
    expect(parseBasicAuth(encode('ada', 'a:b:c'))).toEqual({ user: 'ada', password: 'a:b:c' });
  });

  it('returns undefined for a missing header', () => {
    expect(parseBasicAuth(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-basic scheme', () => {
    expect(parseBasicAuth('Bearer abc')).toBeUndefined();
  });

  it('returns undefined when the decoded value has no colon', () => {
    expect(parseBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBeUndefined();
  });
});

describe('createBasicAuth', () => {
  it('passes everything through when no credentials are configured', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: undefined, password: undefined })(makeReq('/'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects a request without credentials', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic realm=');
  });

  it('rejects a wrong password', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/', encode('ada', 'wrong')), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong user', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/', encode('bob', 'hunter2')), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts correct credentials', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/', encode('ada', 'hunter2')), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('leaves /api/health reachable without credentials', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2' })(makeReq('/api/health'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('honours a custom publicPaths list', () => {
    const next = vi.fn();
    const res = makeRes();

    createBasicAuth({ user: 'ada', password: 'hunter2', publicPaths: ['/ping'] })(makeReq('/ping'), res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm vitest --run server/basic-auth.spec.mjs`
Expected: FAIL — `Failed to resolve import "./basic-auth.mjs"`

- [ ] **Step 3: Die Implementierung schreiben**

`server/basic-auth.mjs`:

```js
import { createHash, timingSafeEqual } from 'node:crypto';

const REALM = 'bolt.diy';

/**
 * Compare two strings without leaking their contents or their length through
 * timing. Hashing first gives both sides a fixed width, which timingSafeEqual
 * requires and which also hides length differences.
 */
function safeEqual(a, b) {
  const digestA = createHash('sha256').update(String(a), 'utf8').digest();
  const digestB = createHash('sha256').update(String(b), 'utf8').digest();

  return timingSafeEqual(digestA, digestB);
}

/**
 * Decode an HTTP Basic Authorization header.
 *
 * @param {string | undefined} header
 * @returns {{ user: string, password: string } | undefined}
 */
export function parseBasicAuth(header) {
  if (typeof header !== 'string' || !header.toLowerCase().startsWith('basic ')) {
    return undefined;
  }

  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');

  if (separator === -1) {
    return undefined;
  }

  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

/**
 * Express middleware enforcing HTTP Basic auth.
 *
 * Returns a pass-through when either credential is unset, so an operator who
 * does not configure BOLT_AUTH_USER / BOLT_AUTH_PASSWORD gets the previous
 * open behaviour rather than a locked-out instance.
 *
 * `publicPaths` stays reachable unauthenticated — the platform healthcheck
 * cannot send credentials.
 */
export function createBasicAuth({ user, password, publicPaths = ['/api/health'] }) {
  if (!user || !password) {
    return function noAuth(_req, _res, next) {
      next();
    };
  }

  return function basicAuth(req, res, next) {
    if (publicPaths.includes(req.path)) {
      next();
      return;
    }

    const credentials = parseBasicAuth(req.headers.authorization);

    if (credentials && safeEqual(credentials.user, user) && safeEqual(credentials.password, password)) {
      next();
      return;
    }

    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
    res.status(401).send('Authentication required');
  };
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `pnpm vitest --run server/basic-auth.spec.mjs`
Expected: PASS — 13 passed

- [ ] **Step 5: Gesamte Testsuite laufen lassen**

Run: `pnpm test`
Expected: PASS — 23 Tests (3 bestehende + 7 aus Task 1 + 13 hier).

- [ ] **Step 6: Commit**

```bash
git add server/basic-auth.mjs server/basic-auth.spec.mjs
git commit -m "$(cat <<'MSG'
feat: HTTP-Basic-Auth-Middleware für den Node-Server

Aktiv nur wenn BOLT_AUTH_USER und BOLT_AUTH_PASSWORD gesetzt sind, sonst
Durchlass — eine nicht konfigurierte Instanz soll nicht ausgesperrt sein.
Vergleich über SHA-256-Digests und timingSafeEqual, damit weder Inhalt noch
Länge der Credentials über Laufzeit verraten werden. /api/health bleibt
unauthentisiert erreichbar, weil Coolifys Healthcheck keine Credentials
senden kann.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Node-Server-Entry und package.json-Scripts

Der eigentliche Produktionsserver. Verdrahtet Task 4, ersetzt `wrangler pages dev`.

**Files:**
- Create: `server/index.mjs`
- Modify: `package.json` (scripts, dependencies)

**Interfaces:**
- Consumes: `createBasicAuth` aus `server/basic-auth.mjs` (Task 4).
- Produces: `pnpm start` startet den Produktionsserver auf `process.env.PORT ?? 5173`.

- [ ] **Step 1: Express und den Remix-Express-Adapter als Dependencies eintragen**

```bash
cd /Users/ros/Documents/Claude/Bolt
pnpm add express@4.22.2 @remix-run/express@2.16.8
node -p "const p=require('./package.json'); [p.dependencies.express, p.dependencies['@remix-run/express']].join(' ')"
```
Expected: `4.22.2 2.16.8` — **ohne** Caret. Falls pnpm ein `^` einfügt, in `package.json` von Hand entfernen und `pnpm install` erneut laufen lassen.

- [ ] **Step 2: Den Server-Entry schreiben**

`server/index.mjs`:

```js
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

app.all('*', createRequestHandler({ build, mode: process.env.NODE_ENV ?? 'production' }));

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
```

- [ ] **Step 3: Die Scripts in package.json ersetzen**

Entfernen: `deploy`, `start:windows`, `start:unix`, `dockerstart`, `typegen`.
Ersetzen/ergänzen:

```json
    "start": "node server/index.mjs",
    "preview": "pnpm run build && pnpm run start",
    "dockerbuild": "docker build -t bolt-ai:latest .",
    "dockerrun": "docker run --rm -p 5173:5173 --env-file .env.local bolt-ai:latest",
```

`dev`, `build`, `test`, `test:watch`, `lint`, `lint:fix`, `typecheck`, `prepare`, `clean` bleiben unverändert. Die `electron:*`-Scripts verschwinden in Task 6.

- [ ] **Step 4: Bauen und starten**

```bash
cd /Users/ros/Documents/Claude/Bolt
pnpm run build
NODE_ENV=production PORT=5199 nohup node server/index.mjs > /tmp/bolt-server.log 2>&1 &
curl -s -m 20 --retry 15 --retry-delay 1 --retry-connrefused --retry-all-errors -w '\nHTTP %{http_code}\n' http://127.0.0.1:5199/api/health
```
Expected: `{"status":"healthy","timestamp":"…"}` und `HTTP 200`

- [ ] **Step 5: SSR und die COOP/COEP-Header prüfen**

```bash
curl -s -m 25 -D - -o /tmp/bolt-index.html http://127.0.0.1:5199/ | grep -iE "^HTTP|cross-origin"
wc -c < /tmp/bolt-index.html
```
Expected:
```
HTTP/1.1 200 OK
cross-origin-embedder-policy: require-corp
cross-origin-opener-policy: same-origin
```
und eine Grösse > 4000 Bytes.

- [ ] **Step 6: Basic-Auth am laufenden Server prüfen**

```bash
pkill -f 'node server/index.mjs'
NODE_ENV=production PORT=5199 BOLT_AUTH_USER=ada BOLT_AUTH_PASSWORD=hunter2 nohup node server/index.mjs > /tmp/bolt-server.log 2>&1 &
echo -n "health ohne Credentials: "; curl -s -m 20 --retry 15 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5199/api/health
echo -n "/ ohne Credentials:      "; curl -s -m 10 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5199/
echo -n "/ mit Credentials:       "; curl -s -m 25 -o /dev/null -w '%{http_code}\n' -u ada:hunter2 http://127.0.0.1:5199/
```
Expected:
```
health ohne Credentials: 200
/ ohne Credentials:      401
/ mit Credentials:       200
```

- [ ] **Step 7: Graceful Shutdown prüfen**

```bash
PID=$(pgrep -f 'node server/index.mjs' | head -1); kill -TERM "$PID"
curl -s -m 6 --retry 5 --retry-delay 1 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5199/api/health 2>/dev/null || echo "Port geschlossen"
grep -c "SIGTERM received" /tmp/bolt-server.log
pgrep -f 'node server/index.mjs' || echo "Prozess beendet"
```
Expected: `SIGTERM received` steht im Log (Zähler `1`), der Prozess ist weg.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
feat: Node-Server-Entry ersetzt wrangler pages dev in Produktion

Express 4 mit @remix-run/express serviert den Remix-Build direkt. Damit
entfallen die workerd-Sandbox, die --binding-Übergabe und der Umweg über
einen Dev-Server in Produktion.

Enthält Basic-Auth-Verdrahtung, fingerprint-gerechte Cache-Header für
/assets und SIGTERM/SIGINT-Handling, ohne das Coolify-Redeploys ins
Kill-Timeout laufen. Bewusst ohne compression-Middleware, weil der Chat per
SSE streamt.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Electron entfernen, tote Dependencies, .gitignore, Versionsstempel

Aufräumarbeiten, die zusammen reviewbar sind: alles, was ersatzlos verschwindet, plus der Ersatz des laufzeit-`git`-Aufrufs.

**Files:**
- Delete: `electron/`, `electron-builder.yml`, `electron-update.yml`, `notarize.cjs`, `vite-electron.config.js`, `.github/workflows/electron.yml`, `scripts/electron-dev.mjs`
- Modify: `package.json` (scripts, dependencies, devDependencies)
- Modify: `.gitignore`
- Modify: `.depcheckrc.json`
- Modify: `app/routes/api.git-info.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: die Umgebungsvariable `BOLT_APP_VERSION`, zur Buildzeit gesetzt und von `api.git-info.ts` gelesen.

- [ ] **Step 1: Die Electron-Dateien löschen**

```bash
cd /Users/ros/Documents/Claude/Bolt
git rm -r --quiet electron electron-builder.yml electron-update.yml notarize.cjs .github/workflows/electron.yml
git rm --quiet vite-electron.config.js scripts/electron-dev.mjs 2>/dev/null || true
ls electron 2>&1 | head -1
```

- [ ] **Step 2: Electron-Scripts und -Dependencies aus package.json entfernen**

Zu löschende Scripts: `electron:dev`, `electron:dev:inspect`, `electron:build:deps`, `electron:build:main`, `electron:build:preload`, `electron:build:renderer`, `electron:build:unpack`, `electron:build:mac`, `electron:build:win`, `electron:build:linux`, `electron:build:dist`.

Aus `dependencies` entfernen: `electron-log`, `electron-store`, `electron-updater`, `react-beautiful-dnd`.
Aus `devDependencies` entfernen: `electron`, `electron-builder`, `@electron/notarize`, `@types/electron`, `@cloudflare/workers-types`, `wrangler`.
Aus `dependencies` entfernen: `@types/react-beautiful-dnd`.

```bash
cd /Users/ros/Documents/Claude/Bolt
pnpm remove electron-log electron-store electron-updater react-beautiful-dnd @types/react-beautiful-dnd \
            electron electron-builder @electron/notarize @types/electron @cloudflare/workers-types wrangler
grep -cE "electron|wrangler|beautiful-dnd|workers-types" package.json
```
Expected: `0`

`@remix-run/cloudflare` und `@remix-run/cloudflare-pages` bleiben **vorerst** drin: `pnpm remove` würde sie entfernen, aber der Design-Entscheid ist, den Cloudflare-Pfad rekonstruierbar zu halten. Sie kosten nichts und werden von keinem Code mehr importiert.

- [ ] **Step 3: `.depcheckrc.json` bereinigen**

`electron*` und `wrangler` aus `ignoreMatches` entfernen:

```json
{
  "ignoreMatches": [
    "@types/*",
    "eslint-*",
    "prettier*",
    "husky",
    "rimraf",
    "vitest",
    "vite",
    "typescript"
  ],
  "ignoreDirs": ["dist", "build", "node_modules", ".git"],
  "skipMissing": false,
  "ignorePatterns": ["*.d.ts", "*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx"]
}
```

- [ ] **Step 4: `.gitignore` entschärfen**

Die Zeile `*.md` ignoriert jedes Markdown im Repo — auch Spec und Plan, die nur mit `git add -f` hereinkamen. Sie war für generierte Changelogs gedacht. Ersetzen:

```bash
cd /Users/ros/Documents/Claude/Bolt
sed -i '' 's|^\*\.md$|# vormals "*.md" — blockierte jede Dokumentation im Repo\nchangelogUI.md|' .gitignore
grep -n "md" .gitignore
```

Erwartet: kein pauschales `*.md` mehr; `changelogUI.md` und `docs/instructions/Roadmap.md` bleiben ignoriert.

- [ ] **Step 5: Den Laufzeit-git-Aufruf durch einen Buildzeit-Stempel ersetzen**

`app/routes/api.git-info.ts` ruft `execSync('git rev-parse …')` zur Laufzeit auf. Im Container gibt es kein `.git` (per `.dockerignore`), der Aufruf läuft also ins Leere. Ergänze am Anfang der Loader-Funktion einen Kurzschluss auf den Buildzeit-Stempel:

```ts
    /*
     * In a container there is no .git directory, so shelling out to git can
     * never succeed. A build-time stamp is both correct and cheaper.
     */
    const stampedVersion = process.env.BOLT_APP_VERSION;

    if (stampedVersion) {
      return Response.json({
        commit: stampedVersion,
        branch: process.env.BOLT_APP_BRANCH ?? 'unknown',
        isDirty: false,
        remoteUrl: process.env.BOLT_APP_REMOTE ?? '',
      });
    }
```

Die exakte Form der Rückgabe muss dem bestehenden Rückgabeobjekt der Datei entsprechen — vor dem Schreiben `sed -n '1,60p' app/routes/api.git-info.ts` lesen und die Feldnamen übernehmen. `json()` ist in dieser Phase noch verfügbar (Remix 2.16.8); wenn die Datei bereits `json(...)` nutzt, dieselbe Form verwenden statt `Response.json`.

- [ ] **Step 6: typecheck, Tests, Build**

Run: `pnpm typecheck && pnpm test && pnpm run build`
Expected: typecheck ohne Ausgabe, 23 Tests PASS, Build `✓ built in …`.

Falls `typecheck` `Cannot find type definition file for 'electron'` meldet: in `tsconfig.json` ist der `types`-Eintrag aus Task 3 Step 5 nicht angekommen.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
chore: Electron, tote Dependencies und Laufzeit-git-Aufruf entfernen

Electron bringt für ein Coolify-Deployment keinen Nutzen, hält aber einen
zweiten Vite-/Remix-Config-Pfad am Leben und verteuert jedes Update.
Entfernt ausserdem react-beautiful-dnd (null Verwendungen im Code),
@cloudflare/workers-types und wrangler.

Das pauschale "*.md" in .gitignore blockierte jede Dokumentation im Repo und
wird auf changelogUI.md eingegrenzt.

api.git-info.ts nutzt einen Buildzeit-Versionsstempel statt execSync('git'),
das im Container ohne .git-Verzeichnis nie erfolgreich sein kann.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Dockerfile, .dockerignore und docker-compose

Vier echte Stages, sodass das Runtime-Image keinen Source-Tree mehr enthält.

**Files:**
- Modify: `Dockerfile` (vollständig ersetzen)
- Modify: `.dockerignore`
- Modify: `docker-compose.yaml` (vollständig ersetzen)

**Interfaces:**
- Consumes: `pnpm start` → `node server/index.mjs` aus Task 5; `BOLT_APP_VERSION` aus Task 6.
- Produces: ein Image mit Default-Stage `runtime`, Healthcheck auf `/api/health`, Port 5173.

- [ ] **Step 1: Das Dockerfile ersetzen**

```dockerfile
# syntax=docker/dockerfile:1

# ---- Stage: deps — alle Dependencies, inklusive dev (für den Build nötig) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app

ENV HUSKY=0 \
    CI=true

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch
RUN pnpm install --offline --frozen-lockfile

# ---- Stage: build — Quellcode bauen ----
FROM deps AS build
WORKDIR /app

# Versionsstempel, damit die App zur Laufzeit kein .git braucht
ARG BOLT_APP_VERSION=unknown
ARG BOLT_APP_BRANCH=unknown
ENV BOLT_APP_VERSION=${BOLT_APP_VERSION} \
    BOLT_APP_BRANCH=${BOLT_APP_BRANCH}

# VITE_*-Variablen werden zur Buildzeit eingebacken, nicht zur Laufzeit gelesen
ARG VITE_LOG_LEVEL=debug
ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL}

COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# ---- Stage: prod-deps — nur Produktions-Dependencies, frisch aus dem Store ----
FROM deps AS prod-deps
WORKDIR /app
RUN pnpm install --offline --frozen-lockfile --prod --ignore-scripts

# ---- Stage: runtime — enthält bewusst keinen Quellcode ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=5173 \
    HOST=0.0.0.0 \
    RUNNING_IN_DOCKER=true

ARG BOLT_APP_VERSION=unknown
ARG BOLT_APP_BRANCH=unknown
ENV BOLT_APP_VERSION=${BOLT_APP_VERSION} \
    BOLT_APP_BRANCH=${BOLT_APP_BRANCH}

ARG DEFAULT_NUM_CTX
ENV DEFAULT_NUM_CTX=${DEFAULT_NUM_CTX}

# API-Keys und BOLT_AUTH_* kommen zur Laufzeit aus der Umgebung, nie ins Image
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/build        ./build
COPY                  server            ./server
COPY                  package.json      ./package.json

RUN chown -R node:node /app
USER node

EXPOSE 5173

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.mjs"]
```

- [ ] **Step 2: `.dockerignore` ergänzen**

Der Build braucht keine Docs, Tests oder das eigene Docker-Material. Ergänze am Ende:

```
# Nicht in den Build-Kontext
docs/
tests/
*.spec.ts
*.spec.tsx
*.spec.mjs
Dockerfile
docker-compose.yaml
.dockerignore
electron-builder.yml
```

Achtung: `server/basic-auth.spec.mjs` wird dadurch nicht ins Image kopiert — gewollt. `server/index.mjs` und `server/basic-auth.mjs` bleiben erfasst, weil nur `*.spec.mjs` ausgeschlossen ist.

- [ ] **Step 3: `docker-compose.yaml` auf einen Produktionsdienst reduzieren**

```yaml
services:
  bolt:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime
      args:
        BOLT_APP_VERSION: ${BOLT_APP_VERSION:-local}
        BOLT_APP_BRANCH: ${BOLT_APP_BRANCH:-local}
    image: bolt-ai:latest
    ports:
      - '5173:5173'
    env_file:
      - path: .env.local
        required: false
    environment:
      NODE_ENV: production
      PORT: 5173
      HOST: 0.0.0.0
      RUNNING_IN_DOCKER: 'true'
      DEFAULT_NUM_CTX: ${DEFAULT_NUM_CTX:-32768}
      VITE_LOG_LEVEL: ${VITE_LOG_LEVEL:-debug}
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    restart: unless-stopped
```

Die bisherigen drei Profile (`production`, `development`, `prebuilt`) und die 12 einzeln durchgereichten API-Keys entfallen: Keys kommen aus `.env.local` bzw. auf Coolify aus der UI, und sie müssen nicht mehr namentlich aufgezählt werden, weil `process.env` vollständig ankommt.

- [ ] **Step 4: Compose-Syntax validieren**

Run: `docker compose config --quiet`
Expected: keine Ausgabe.
Falls Docker lokal nicht vorhanden ist (der Fall in dieser Umgebung): Schritt überspringen und in Task 8 notieren, dass die Validierung ausschliesslich in CI erfolgt. Die Konfiguration wird dann durch den CI-Job aus Task 8 geprüft, nicht lokal.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
build: Dockerfile in vier Stages trennen und auf den Node-Server umstellen

Die bisherige Kette build -> prod-deps -> production liess das
Produktionsimage den gesamten Quellcode und die Build-Caches enthalten, und
"pnpm prune --prod" entfernte wrangler, obwohl der Startbefehl es aufrief.

Neu: deps, build, prod-deps und ein runtime-Image, das nur build/, server/,
Produktions-node_modules und package.json enthält. Dazu dumb-init als PID 1
für korrekte Signalweitergabe, ein Non-Root-User und ein Healthcheck auf
/api/health statt auf / , das die komplette App per SSR rendern musste.

docker-compose wird von drei Profilen auf einen Produktionsdienst reduziert;
die namentliche Aufzählung der API-Keys entfällt, weil process.env jetzt
vollständig ankommt.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: CI — Node 22, Docker-Smoke-Test, Electron-Workflow entfernen

Weil lokal kein Docker verfügbar ist, ist dieser Job die einzige Stelle, die das Image vor Coolify tatsächlich baut und startet. Er ist damit sicherheitsrelevant, nicht Kosmetik.

**Files:**
- Modify: `.github/actions/setup-and-build/action.yaml`
- Modify: `.github/workflows/ci.yaml`
- Modify: `.github/workflows/preview.yaml`
- Modify: `.github/workflows/docker.yaml`

**Interfaces:**
- Consumes: das `runtime`-Target und den `/api/health`-Healthcheck aus Task 7; `BOLT_AUTH_*` aus Task 4/5.
- Produces: nichts für späteren Code.

- [ ] **Step 1: Node- und pnpm-Version anheben**

`.github/actions/setup-and-build/action.yaml` — die Defaults müssen dem Dockerfile entsprechen, sonst prüft CI eine andere Runtime als Produktion:

```yaml
inputs:
  pnpm-version:
    required: false
    type: string
    default: '9.14.4'
  node-version:
    required: false
    type: string
    default: '22.21.0'
```

`pnpm` bleibt bei 9.14.4, weil `package.json` das über `packageManager` festschreibt und das Dockerfile dieselbe Version aktiviert. Ein Sprung auf pnpm 10 gehört in Phase 2, wo der Lockfile ohnehin neu geschrieben wird.

- [ ] **Step 2: Den docker-validation-Job durch einen Smoke-Test ersetzen**

In `.github/workflows/ci.yaml` den bestehenden `docker-validation`-Job vollständig ersetzen:

```yaml
  docker-smoke-test:
    name: Docker Build und Smoke-Test
    runs-on: ubuntu-latest
    timeout-minutes: 25

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Image bauen
        run: |
          docker build \
            --target runtime \
            --build-arg BOLT_APP_VERSION="${GITHUB_SHA::7}" \
            --build-arg BOLT_APP_BRANCH="${GITHUB_REF_NAME}" \
            -t bolt-ai:ci \
            --progress=plain \
            .

      - name: Container starten
        run: |
          docker run -d --name bolt-ci \
            -p 5173:5173 \
            -e BOLT_AUTH_USER=ci \
            -e BOLT_AUTH_PASSWORD=ci-secret \
            bolt-ai:ci

      - name: Auf Healthcheck warten
        run: |
          for i in $(seq 1 60); do
            status=$(docker inspect --format='{{.State.Health.Status}}' bolt-ci 2>/dev/null || echo starting)
            echo "Versuch $i: $status"
            if [ "$status" = "healthy" ]; then exit 0; fi
            if [ "$status" = "unhealthy" ]; then
              echo "::error::Container ist unhealthy"
              docker logs bolt-ci
              exit 1
            fi
            sleep 2
          done
          echo "::error::Healthcheck wurde nicht healthy"
          docker logs bolt-ci
          exit 1

      - name: /api/health ist ohne Credentials erreichbar
        run: |
          code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/api/health)
          echo "HTTP $code"
          [ "$code" = "200" ] || { docker logs bolt-ci; exit 1; }

      - name: / ist ohne Credentials gesperrt
        run: |
          code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/)
          echo "HTTP $code"
          [ "$code" = "401" ] || { docker logs bolt-ci; exit 1; }

      - name: / liefert mit Credentials SSR samt COOP/COEP
        run: |
          headers=$(curl -s -D - -o /tmp/index.html -u ci:ci-secret http://127.0.0.1:5173/)
          echo "$headers"
          echo "$headers" | grep -qi 'HTTP/1.1 200' || { docker logs bolt-ci; exit 1; }
          echo "$headers" | grep -qi 'cross-origin-embedder-policy: require-corp' || { echo "::error::COEP fehlt"; exit 1; }
          echo "$headers" | grep -qi 'cross-origin-opener-policy: same-origin' || { echo "::error::COOP fehlt"; exit 1; }
          size=$(wc -c < /tmp/index.html)
          echo "HTML-Grösse: $size"
          [ "$size" -gt 2000 ] || { echo "::error::HTML zu klein, SSR vermutlich fehlgeschlagen"; exit 1; }

      - name: Logs auf Fehler prüfen
        run: |
          docker logs bolt-ci 2>&1 | tee /tmp/bolt.log
          if grep -Ei 'SyntaxError|Cannot find module|UnhandledPromiseRejection|ERR_MODULE_NOT_FOUND' /tmp/bolt.log; then
            echo "::error::Fehler im Containerlog"
            exit 1
          fi

      - name: Graceful Shutdown prüfen
        run: |
          docker stop -t 15 bolt-ci
          docker logs bolt-ci 2>&1 | grep -q 'SIGTERM received' || {
            echo "::error::SIGTERM wurde nicht behandelt"
            docker logs bolt-ci
            exit 1
          }

      - name: docker-compose validieren
        run: docker compose config --quiet

      - name: Aufräumen
        if: always()
        run: docker rm -f bolt-ci || true
```

- [ ] **Step 3: preview.yaml auf den Node-Server umstellen**

Prüfen, wie der Workflow die App startet:

```bash
grep -nE "wrangler|start|dockerstart|pnpm run" .github/workflows/preview.yaml
```

Jeden `wrangler`- bzw. `start:unix`-Aufruf durch `pnpm run start` ersetzen. Falls der Workflow auf `bindings.sh` oder `wrangler pages dev` aufbaut und sich nicht mit einer Zeile umstellen lässt, den Workflow mit `if: false` und einem Kommentar deaktivieren, der auf Phase 2 verweist — ein kaputter Playwright-Job, der bei jedem Push rot ist, kostet mehr als er bringt.

- [ ] **Step 4: docker.yaml auf das neue Target prüfen**

```bash
grep -nE "target|bolt-ai-production|development" .github/workflows/docker.yaml
```

Jedes `--target bolt-ai-production` bzw. `target: bolt-ai-production` auf `runtime` ändern. Referenzen auf ein `development`-Target entfernen, da diese Stage nicht mehr existiert.

- [ ] **Step 5: Die Workflow-Syntax prüfen**

```bash
cd /Users/ros/Documents/Claude/Bolt
for f in .github/workflows/ci.yaml .github/workflows/preview.yaml .github/workflows/docker.yaml .github/actions/setup-and-build/action.yaml; do
  node -e "
    const fs=require('fs');
    const text=fs.readFileSync('$f','utf8');
    if (text.includes('\t')) { console.error('$f enthält Tabs — in YAML ungültig'); process.exit(1); }
    console.log('$f: ' + text.split('\n').length + ' Zeilen, keine Tabs');
  "
done
grep -rn "bolt-ai-production\|dockerstart\|bindings.sh\|wrangler" .github/ || echo "keine Worker-Referenzen mehr in .github/"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
ci: Docker-Smoke-Test statt reiner Build-Validierung

Da lokal kein Docker verfügbar ist, ist dieser Job die einzige Stelle, die
das Image vor dem Coolify-Deploy tatsächlich baut und startet. Er prüft den
Healthcheck, dass /api/health unauthentisiert erreichbar und / gesperrt ist,
dass SSR mit Credentials samt COOP- und COEP-Header ausgeliefert wird, dass
das Containerlog frei von Modul- und Syntaxfehlern ist und dass SIGTERM
behandelt wird.

Hebt Node in CI auf 22.21.0, damit CI dieselbe Runtime prüft wie Produktion,
und entfernt die Referenzen auf die weggefallenen Docker-Targets.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Dokumentation

Die README beschreibt an mehreren Stellen den Wrangler-Startweg. Ohne Korrektur verweist die Doku auf gelöschte Dateien.

**Files:**
- Modify: `README.md` (Zeilen um 133, 155-201, 477-481)
- Modify: `FAQ.md` (falls dort Docker- oder Wrangler-Verweise stehen)
- Create: `docs/coolify.md`

**Interfaces:**
- Consumes: die Coolify-Konfiguration aus Abschnitt 8 des Specs.
- Produces: nichts für Code.

- [ ] **Step 1: Die betroffenen Stellen finden**

```bash
cd /Users/ros/Documents/Claude/Bolt
grep -nE "wrangler|bindings\.sh|dockerstart|bolt-ai-production|--target development" README.md FAQ.md CONTRIBUTING.md docs/docs/*.md 2>/dev/null
```

- [ ] **Step 2: README korrigieren**

Jede gefundene Stelle anpassen. Insbesondere:
- `pnpm run dockerbuild:prod` → `pnpm run dockerbuild`
- `docker build --target bolt-ai-production` → `docker build --target runtime`
- `docker compose --profile production up` → `docker compose up`
- Den Satz, der erklärt, dass beim Containerstart `dockerstart` und `bindings.sh` Cloudflare-Bindings durchreichen (Zeile ~201), ersetzen durch:

```markdown
When the container starts it runs `node server/index.mjs`, an Express server that
serves the Remix build. Environment variables are read directly from the process
environment — there is no binding or Wrangler step involved. Set `BOLT_AUTH_USER`
and `BOLT_AUTH_PASSWORD` to require HTTP Basic auth; `/api/health` stays reachable
without credentials so platform healthchecks keep working.
```

- Im Scripts-Abschnitt (~477) `dockerstart` entfernen und `start` als `node server/index.mjs` beschreiben.

- [ ] **Step 3: `docs/coolify.md` anlegen**

```markdown
# bolt.diy auf Coolify betreiben

## Application anlegen

- Typ: **Dockerfile** (Git-Repository mit Build-Pack `dockerfile`)
- Repository: dieser Fork, Branch `main`
- Dockerfile-Pfad: `./Dockerfile`
- Build-Target: `runtime`

## Port und Healthcheck

- Container-Port: **5173**. Der Server liest `PORT` aus der Umgebung und folgt
  Coolify automatisch, falls dort ein anderer Wert gesetzt ist.
- Healthcheck-Pfad: **`/api/health`** mit einer `start_period` von mindestens
  30 Sekunden. Ein Healthcheck auf `/` rendert die komplette Anwendung per SSR
  und kann bei kaltem Start allein einen Crash-Loop auslösen.

## Domain und TLS — nicht optional

Die Domain **muss** ein TLS-Zertifikat haben. WebContainer benötigt einen
Secure Context; über `http://<ip>:5173` startet die Preview-Funktion nicht,
auch wenn der Server einwandfrei läuft.

Traefik darf die folgenden Header nicht entfernen, sonst bleibt WebContainer
tot:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Prüfen lässt sich das mit:

```bash
curl -sS -D - -o /dev/null https://<deine-domain>/ | grep -i cross-origin
```

## Environment-Variablen

Alles als normale Runtime-Variablen:

| Variable | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic-Modelle |
| `OPENAI_API_KEY` | OpenAI-Modelle |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google-Modelle |
| `BOLT_AUTH_USER` | Basic-Auth-Benutzername |
| `BOLT_AUTH_PASSWORD` | Basic-Auth-Passwort |
| `DEFAULT_NUM_CTX` | optional, Standard 32768 |

**Zugriffsschutz:** bolt.diy hat keine eigene Benutzerverwaltung. Wer die URL
kennt, kann Modelle auf Kosten der hinterlegten Keys abfragen. Setze deshalb
`BOLT_AUTH_USER` und `BOLT_AUTH_PASSWORD`, sobald serverseitige Keys
konfiguriert sind. Sind beide leer, läuft die Instanz bewusst ungeschützt.

**`VITE_*`-Variablen sind eine Ausnahme:** sie werden zur *Buildzeit*
eingebacken und nicht zur Laufzeit gelesen. In Coolify müssen sie als
Build-Variable markiert sein, sonst haben sie keine Wirkung.
```

- [ ] **Step 4: Verifizieren, dass keine Verweise auf gelöschte Dateien übrig sind**

```bash
cd /Users/ros/Documents/Claude/Bolt
grep -rnE "bindings\.sh|dockerstart|worker-configuration|wrangler pages dev" \
  README.md FAQ.md CONTRIBUTING.md docs/ .github/ package.json Dockerfile docker-compose.yaml 2>/dev/null \
  || echo "keine Verweise auf entfernte Dateien"
```

- [ ] **Step 5: Abschliessende Gesamtverifikation**

```bash
cd /Users/ros/Documents/Claude/Bolt
pnpm typecheck && pnpm run lint && pnpm test && pnpm run build && echo "ALLES GRÜN"
```
Expected: `ALLES GRÜN`, 23 Tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
docs: Dokumentation auf den Node-Server umstellen, Coolify-Anleitung ergänzen

Die README beschrieb den Start über wrangler pages dev und bindings.sh und
verwies damit auf gelöschte Dateien. Neu dokumentiert docs/coolify.md die
Konfiguration inklusive der beiden Punkte, die erfahrungsgemäss schiefgehen:
der Healthcheck muss auf /api/health zeigen, und die Domain braucht TLS, weil
WebContainer sonst gar nicht startet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Definition of Done für Phase 1

- [ ] `pnpm typecheck` ohne Ausgabe (Exit 0) — der Baseline-Fehler ist verschwunden
- [ ] `pnpm lint` grün
- [ ] `pnpm test` grün, 23 Tests
- [ ] `pnpm run build` erzeugt `build/client` und `build/server/index.js`
- [ ] `pnpm start` serviert `/api/health` mit 200 und `/` mit SSR-HTML samt COOP/COEP
- [ ] Mit gesetzten `BOLT_AUTH_*`: `/` ohne Credentials 401, mit Credentials 200, `/api/health` immer 200
- [ ] `SIGTERM` beendet den Server sauber und protokolliert das
- [ ] Kein Vorkommen von `wrangler`, `bindings.sh`, `worker-configuration`, `dockerstart` oder `@remix-run/cloudflare` in `app/`, `.github/`, `package.json`, `Dockerfile`
- [ ] Neun Commits auf dem Branch `feat/node-runtime-coolify`
- [ ] **Nicht gepusht** — der GitHub-Zugang wird erst danach eingerichtet
