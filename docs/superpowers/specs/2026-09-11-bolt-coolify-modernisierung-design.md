# bolt.diy Fork — Coolify-Optimierung und Modernisierung

**Datum:** 2026-09-11
**Repository:** `rscolari79/bolt.diy` (Fork von `stackblitz-labs/bolt.diy`)
**Status:** Design freigegeben, Implementationsplan Phase 1 ausstehend

## 1. Ausgangslage

Der Fork ist auf dem Stand von Upstream `stackblitz-labs/bolt.diy`, dessen Entwicklung am
**2026-02-07** endete, plus einem eigenen Commit (`baefa43`, Dockerfile). Es gibt keine
Upstream-Commits zum Nachziehen — "Aktualisierung" bedeutet hier ausschliesslich
Dependencies, nicht einen Merge.

Die Anwendung ist eine Remix-v2-App, die für **Cloudflare Pages** gebaut wird. In
Produktion startet sie über

```
dockerstart: bindings=$(./bindings.sh) && wrangler pages dev ./build/client $bindings \
             --ip 0.0.0.0 --port 5173 --no-show-interactive-dev-session
```

also mit einem **Dev-Server (`wrangler pages dev`, workerd-Sandbox) als Produktionsserver**.
Das ist die Wurzel der Coolify-Probleme.

### 1.1 Konkret nachgewiesene Defekte

| # | Defekt | Ort |
|---|--------|-----|
| 1 | `pnpm prune --prod` entfernt `wrangler` (steht in `devDependencies`), das Produktions-Image ruft danach `wrangler` auf | `Dockerfile:37`, `package.json:209` |
| 2 | `bindings.sh` baut aus Environment-Variablen `--binding K=V`-CLI-Argumente: unquoted, `cut -d '=' -f 2-`, `echo $bindings`. Werte mit Leerzeichen, Newlines oder `=` brechen. Zudem passieren **nur** Variablen, die in `worker-configuration.d.ts` deklariert sind — alles andere wird still verworfen | `bindings.sh` |
| 3 | workerd besitzt kein echtes `process.env`. Der Code greift gemischt auf `context.cloudflare?.env` (11 Stellen) und `process.env` (32 Stellen) zu; derselbe Key funktioniert je nach Route oder nicht | `app/routes/api.*` |
| 4 | `remixCloudflareDevProxy()` lief auch im Build (`config.mode !== 'test'`), umgangen durch einen `sed`-Aufruf im Dockerfile | `vite.config.ts:46`, `Dockerfile:26` |
| 5 | Die Final-Stage ist `FROM prod-deps` → `FROM build`: das Runtime-Image enthält den gesamten Source-Tree und die Build-Caches. Die `COPY --from=prod-deps`-Zeilen sind dabei redundant | `Dockerfile:34,41,66-69` |
| 6 | Wrangler schreibt nach `$HOME`, prüft Updates, sendet Metriken; kein sauberes SIGTERM-Handling → hängende Container bei Redeploys | Laufzeit |
| 7 | Healthcheck auf `/` rendert die komplette App per SSR, obwohl `/api/health` existiert | `Dockerfile:82` |
| 8 | `react-dom/server` löst in Node auf `server.node.js` auf und exportiert **kein** `renderToReadableStream`; `entry.server.tsx` würde unter Node sofort brechen | `app/entry.server.tsx:4` |
| 9 | Der globale Typ `Env` stammt aus `worker-configuration.d.ts` und wird an 31 Stellen in 25 Dateien verwendet | `base-provider.ts`, 22 Provider, `stream-text.ts` u. a. |
| 10 | Keine Authentisierung. API-Keys kommen aus Browser-Cookies oder Server-Environment. Eine öffentlich erreichbare Instanz mit serverseitigen Keys lässt jeden auf fremde Rechnung Modelle abfragen | `app/routes/api.chat.ts:71` |

### 1.2 Entlastende Befunde

- **Keine echte Cloudflare-Abhängigkeit.** Kein KV, D1, R2, Durable Objects, `waitUntil`,
  `HTMLRewriter`, `caches.default`. Die 39 `@remix-run/cloudflare`-Imports sind fast
  ausschliesslich Typen und `json`.
- **Kaum Router-Nutzung.** 4× `useLoaderData`, 0× `useFetcher`, 0× `<Form>`, 0× `useActionData`.
  bolt ist im Kern eine SPA mit 38 API-Routen.
- **React 19 ist billig.** Kein `propTypes`, `defaultProps`, `ReactDOM.render`, keine String-Refs,
  kein argumentloses `useRef()`. 31× `forwardRef` (in React 19 weiterhin funktionsfähig).
- **`react-beautiful-dnd` ist eine tote Dependency** (0 Verwendungen) — der klassische
  React-19-Blocker entfällt.
- **nanostores ist billig.** Die zunächst vermuteten 37 `action()`-Aufrufe waren Fehlalarm
  (`ActionRunner`, `transaction`); es gibt **null** echte nanostores-`action()`-Aufrufe.
- **CI baut das Docker-Image bereits** (`docker-validation` in `ci.yaml`).

### 1.3 Risikofaktor Testabdeckung

**Drei Testdateien für ~70.000 Zeilen Code** (`app/utils/diff.spec.ts`,
`app/components/chat/Markdown.spec.ts`, `app/lib/runtime/message-parser.spec.ts`).
Ein grünes `pnpm test` sagt praktisch nichts aus. Daraus folgt: `typecheck` ist die
wichtigste Absicherung, und das ist ein Argument für die Paketmigrationen, weil
TypeScript bei Paketwechseln jede vergessene Stelle meldet.

## 2. Getroffene Entscheidungen

| Entscheidung | Wahl |
|---|---|
| Produktions-Runtime | **Node-Server** (Express + Remix-/React-Router-Node-Adapter) |
| Cloudflare-Pfad | **nicht aktiv gepflegt**; über Git-History rekonstruierbar, Env-Abstraktion bleibt portierbar |
| Vorgehen | **Phasenweise**, Coolify zuerst, jede Phase eigener PR und einzeln deploybar |
| Electron | **entfernen** |
| Coolify-Typ | **Dockerfile-Application** |
| Zugriffsschutz | **Basic-Auth in der Anwendung**, über Environment aktiviert |
| Verifikation | **Direkt auf Coolify**, lokal ohne Docker; ergänzt um einen Docker-Smoke-Test in CI |
| Provider-Verifikation | **Anthropic, OpenAI, Google** |

## 3. Dependency-Abstand und Zwangsketten

| Paket | Ist | Aktuell |
|---|---|---|
| `vite` | 5.4 | 8.3 |
| `react` | 18.3 | 19.3 |
| `@remix-run/*` | 2.15 | 2.17 (EOL) |
| `ai` | 4.3 | 7.0 |
| `@ai-sdk/anthropic` | 0.0.39 | 4.0.52 |
| `@ai-sdk/google` | 0.0.52 | 4.0.67 |
| `typescript` | 5.7 | 7.0 |
| `vitest` | 2.1 | 5.0 |
| `unocss` | 0.61 | 66.10 |
| `nanostores` | 0.10 | 1.5 |
| `zod` | 3.24 | 4.6 |

Gegen die npm-Registry verifizierte Einschränkungen:

- `@remix-run/dev@2.17.5` deklariert `vite: ^5.1.0 || ^6.0.0` → **mit Remix ist bei Vite 6 Schluss**.
- `vitest@5` deklariert `vite: ^6.4.0 || ^7 || ^8`.
- `@react-router/dev@7.18.3` deklariert `vite: ^5 || ^6 || ^7 || ^8`, `typescript: ^5.1 || ^6`,
  `react-router` peer `react: >=18` → **öffnet die Toolchain ohne React-19-Zwang**.
- `@react-router/dev@8.3.1` verlangt Vite 7/8 **plus** `react-server-dom-webpack@^19.2.7`
  (RSC-Fundament) → nicht gerechtfertigt.
- **TypeScript landet daher auf 6, nicht 7.** React Router 7 deklariert `^5.1 || ^6`.
- `@react-router/express@7.18.3` deklariert `express: ^4.17.1 || ^5`;
  `@remix-run/express@2.17.5` verlangt `express: ^4.20.0` → Phase 1 nutzt Express 4.
- `json` ist in `react-router@7.18.3` **nicht mehr exportiert** (vorhanden: `data`, `redirect`,
  `redirectDocument`, `replace`).
- `unocss@66.10.2`, `vite-plugin-node-polyfills@0.28`, `vite-plugin-optimize-css-modules@1.4`
  deklarieren alle Vite 8 → Vite 8 ist durchgängig tragfähig.
- `remix-island@0.2.0` peer-depended auf `@remix-run/react` und `@remix-run/server-runtime`
  → **unter React Router 7 nicht verwendbar**.
- `@openrouter/ai-sdk-provider@3.0.0` verlangt `ai: ^7.0.0` → das AI SDK lässt sich nicht
  teilweise aktualisieren.
- `ollama-ai-provider` steht bei 1.2.0; gepflegt wird `ollama-ai-provider-v2@4.0.1`
  → Paketwechsel.

## 4. Phase 1 — Node-Runtime und Coolify

Ziel: aus "Vite baut für workerd, `wrangler pages dev` serviert, Environment reist als
CLI-Flags" wird "Vite baut für Node, ein expliziter Express-Server serviert, Environment
kommt aus `process.env`".

### 4.1 Datenfluss

```
VORHER:  Coolify env → bindings.sh → --binding K=V → wrangler pages dev (workerd)
                        (Allowlist aus       (shell-unsicher)
                    worker-configuration.d.ts)
                                → functions/[[path]].ts → build/server
                                → context.cloudflare.env (11) | process.env (32)

NACHHER: Coolify env → process.env → server/index.mjs (Express 4)
                                      ├─ Basic-Auth-Middleware (/api/health frei)
                                      ├─ express.static für build/client
                                      └─ createRequestHandler
                                → build/server/index.js
                                → getServerEnv(context)  (eine Quelle)
```

### 4.2 Bausteine

1. **`server/index.mjs`** — Express 4.22 + `@remix-run/express`. Port `process.env.PORT ?? 5173`,
   Host `0.0.0.0`. Enthält Basic-Auth-Middleware, `/api/health` vor der Auth,
   `express.static` für `build/client` (Assets `immutable, max-age=1y`, Rest `max-age=1h`),
   sowie `SIGTERM`/`SIGINT`-Handler mit `server.close()` für saubere Coolify-Redeploys.
   Überlebt Phase 2 durch Umbenennung des Imports auf `@react-router/express`.
2. **`app/lib/.server/env.ts`** — `getServerEnv(context?)` führt `process.env` mit
   `context?.cloudflare?.env` zusammen (letzteres als Fallback für Portierbarkeit). Ersetzt die
   11 `context.cloudflare?.env`-Stellen und vereinheitlicht die 32 direkten `process.env`-Zugriffe.
   Exportiert den Typ **`ServerEnv`** als Ersatz für den ambienten `Env` (31 Stellen, 25 Dateien).
3. **Adapter-Wechsel** — `@remix-run/cloudflare` → `@remix-run/node` in 39 Dateien (überwiegend
   Typen und `json`). In `vite.config.ts` entfällt `remixCloudflareDevProxy()`, womit der
   `sed`-Hack im Dockerfile ersatzlos wegfällt.
4. **`app/entry.server.tsx`** — Import auf `react-dom/server.browser` (siehe Defekt 8).
   COOP/COEP-Header bleiben unverändert; WebContainer benötigt sie.
5. **Dockerfile, vier Stages:** `deps` (`pnpm fetch` + Install) → `build` (Source, `pnpm build`,
   Versionsstempel) → `prod-deps` (frischer `pnpm install --prod`) → `runtime` (`node:22-slim`,
   nur `build/`, `server/`, Prod-`node_modules`, `package.json`). Dazu `dumb-init` als PID 1,
   Non-Root-User, Healthcheck auf `/api/health`. Kein `wrangler`, kein `bindings.sh`.
6. **Basic-Auth** — aktiv nur wenn `BOLT_AUTH_USER` und `BOLT_AUTH_PASSWORD` gesetzt sind,
   Vergleich mit `crypto.timingSafeEqual`, `/api/health` ausgenommen. Der Browser sendet die
   Credentials an alle Subrequests, WebContainer-Previews brechen nicht.
7. **Versionsstempel** — `api.git-info.ts` ruft zur Laufzeit `execSync('git …')` auf, findet aber
   wegen `.dockerignore` kein `.git`. Ersatz durch einen Build-Time-Stempel.

### 4.3 Entfällt ersatzlos

`bindings.sh`, `worker-configuration.d.ts`, `wrangler.toml`, `functions/[[path]].ts`,
`load-context.ts`, `wrangler` als Dependency, der `sed`-Hack, die Scripts
`deploy`/`start:windows`/`start:unix`/`dockerstart`/`typegen`; der Electron-Block
(`electron/`, 6 Scripts, `electron-builder.yml`, `notarize.cjs`, `electron.yml`,
5 Dependencies); die tote Dependency `react-beautiful-dnd` samt `@types`.

### 4.4 Nicht Bestandteil von Phase 1

Keine Dependency-Majors. React bleibt 18.3, Remix 2.15, Vite 5.4, AI SDK 4.3. Neuzugänge nur
`express` und `@remix-run/express`. Grund: scheitert der erste Coolify-Deploy, soll die Ursache
eindeutig in der Runtime-Umstellung liegen.

## 5. Phase 2 — Framework und Toolchain

### 5.1 Remix v2 → React Router 7.18.3

| alt | neu |
|---|---|
| `@remix-run/dev` | `@react-router/dev` |
| `@remix-run/react` | `react-router` |
| `@remix-run/node` | `@react-router/node` |
| `@remix-run/express` | `@react-router/express` |
| `@remix-run/serve` | entfällt |

Vier inhaltliche Eingriffe:

- **Routen-Konvention bewahren** über `flatRoutes()` aus `@react-router/fs-routes` in einer
  dreizeiligen `app/routes.ts`. Keine der 38 Route-Dateien wird umbenannt.
- **`json()` ersetzen** — 148 Aufrufstellen in 28 Dateien, nach `Response.json(x[, init])`.
  Verhaltensgleich, mechanisch, eigener Commit.
- **`remix-island` vendoren** (~100 Zeilen nach `app/lib/head.tsx`, 2 Aufrufstellen).
  Das Paket steht bei 0.2.0 und ist unter RR7 nicht verwendbar.
- **`remix-utils` entfernen** — genutzt wird nur `ClientOnly` in 7 Dateien; Version 10 zieht
  zahlreiche `@edgefirst-dev/*`- und `@oslojs/*`-Peers nach. Vendoren statt aktualisieren.

`server/index.mjs` ändert nur seine Imports; Basic-Auth, Signal-Handling und Static-Header
bleiben unberührt.

### 5.2 Toolchain

`vite` 5.4 → **8.3**, `vitest` 2.1 → **5.0**, `typescript` 5.7 → **6.x**,
`unocss` 0.61 → **66.10** (inkl. `@unocss/reset`), `nanostores` 0.10 → **1.5**
(+ `@nanostores/react` 2.0), `zod` 3.24 → **4.6**, `isbot` 4.4 → **5.2**,
`vite-plugin-node-polyfills` 0.22 → **0.28**, `prettier` 3.5 → **3.9**.

### 5.3 React 19

React 18.3 → **19.3**, `@types/react`/`@types/react-dom` 19. Die 31 `forwardRef`-Stellen bleiben
bewusst unangetastet. Konkrete Arbeiten: `react-window` 1.8 → 2.3 (`FixedSizeList` → `List`,
1 Datei: `app/components/ui/Dialog.tsx`), `framer-motion` 11 → 13, `react-toastify` 10 → 11.

### 5.4 ESLint

`eslint.config.mjs` hängt an `@blitz/eslint-plugin@0.1.0` und greift per Deep-Import in dessen
`dist/configs/*`. Die `resolutions`-Klammer `"@typescript-eslint/utils": "^8.0.0-alpha.30"` ist
das Symptom. Ersatz durch `typescript-eslint` + `eslint-plugin-react-hooks` auf **ESLint 10**,
projekteigene Regeln wortgleich übernommen (inklusive des `no-restricted-imports`-Verbots
relativer Importe). `getNamingConventionRule` wird als explizite
`@typescript-eslint/naming-convention`-Regel neu formuliert. Die `resolutions`-Klammer entfällt.

### 5.5 Commit-Reihenfolge

1. `json()` → `Response.json()` (noch unter Remix)
2. `remix-island` + `remix-utils` vendoren
3. Paket-Renames + `routes.ts` + `vite.config.ts`
4. Vite 8 + Vitest 5 + TS 6 + UnoCSS 66
5. React 19 + `react-window` 2 + framer-motion 13
6. ESLint 10 + `typescript-eslint`, `resolutions` entfernen

Renames (3) und Vite-Sprung (4) bleiben getrennt, weil dort der einzige Punkt liegt, an dem die
App kurzzeitig nicht baubar sein könnte.

## 6. Phase 3 — AI SDK 4 → 7

### 6.1 Begründung

`@ai-sdk/anthropic` steht bei 0.0.39, `@ai-sdk/google` bei 0.0.52, `@ai-sdk/mistral` bei 0.0.43 —
Stände von Mitte 2024, ohne Prompt-Caching, Extended Thinking und aktuelle Tool-/Vision-Semantik.
Hier liegt echte Funktionalität brach.

### 6.2 Serverseite

| v4 | v7 |
|---|---|
| `createDataStream({ execute })` | `createUIMessageStream({ execute })` |
| `dataStream.writeData({...})` (5×) | `writer.write({ type: 'data-…', data })` |
| `dataStream.writeMessageAnnotation({...})` (4×) | Data-Parts bzw. `messageMetadata` |
| `result.mergeIntoDataStream(dataStream)` (2×) | `writer.merge(result.toUIMessageStream())` |
| `new Response(dataStream, …)` | `createUIMessageStreamResponse({ stream })` |
| `CoreMessage` / `convertToCoreMessages` | `ModelMessage` / `convertToModelMessages` |
| `maxTokens` | `maxOutputTokens` |
| `usage.promptTokens` / `.completionTokens` | `usage.inputTokens` / `.outputTokens` |

Betroffen: `app/routes/api.chat.ts` (~430 Zeilen) sowie `stream-text.ts`,
`switchable-stream.ts`, `select-context.ts`, `create-summary.ts`, `stream-recovery.ts`,
`mcpService.ts` (`processToolInvocations(messages, dataStream)` sitzt auf dem alten Tool-Modell).

### 6.3 Clientseite

- `useChat({ api, body, sendExtraMessageFields })` → `transport: new DefaultChatTransport({ api, body })`
  (`Chat.client.tsx:134-153`, inkl. apiKeys, files, promptId, designScheme, Supabase-Credentials,
  maxLLMSteps).
- **`message.annotations` entfällt** — gelesen in `Messages.client.tsx:56,59,78` und
  `AssistantMessage.tsx:23,65,77`, inklusive `annotations?.includes('hidden')`
  (`Chat.client.tsx:453`). Umstellung auf typisierte Data-Parts.
- `message.content` → `message.parts`.
- `append`/`reload`/`isLoading` → `sendMessage`/`regenerate`/`status`.
- `input`, `handleInputChange`, `handleSubmit` werden nicht mehr geliefert; Eingabezustand
  lokal halten.

Umfang: 23 `useChat`-Berührungen, 19 `toolInvocations`-Stellen.

### 6.4 Die 22 LLM-Provider

`app/lib/modules/llm/types.ts` und `base-provider.ts` typisieren `getModelInstance` gegen
`LanguageModelV1` aus `ai` — 49 Vorkommen. Ersatz: `LanguageModelV2` aus `@ai-sdk/provider`.
Jeder der 22 Adapter erhält denselben mechanischen Eingriff (Modell-Typ tauschen,
Paketversion hochziehen); `typecheck` meldet jede vergessene Stelle. Die Umstellung von
`serverEnv: Env` auf `ServerEnv` ist **bereits in Phase 1 erfolgt** (Abschnitt 4.2, Punkt 2) —
sie ist dort zwingend, weil `worker-configuration.d.ts` in Phase 1 entfällt und `typecheck`
sonst sofort bricht.

Zwei Adapter wechseln das Paket: `@openrouter/ai-sdk-provider` 0.0.5 → 3.0.0 (verlangt `ai: ^7`),
`ollama-ai-provider` 1.2.0 → `ollama-ai-provider-v2` 4.0.1. Dazu `zod` 3 → 4 (Peer von `ai@7`)
und `@modelcontextprotocol/sdk` 1.15 → 1.30.

### 6.5 Verifikationsreihenfolge

Server und Client sprechen ein gemeinsames Stream-Protokoll; eine halbe Migration ergibt eine
App, die baut und typecheckt, aber beim ersten Chat stumm bleibt. Daher in einem Zug migrieren,
aber in dieser Reihenfolge verifizieren:

1. **Provider-Layer** (Typen + Paketversionen), isoliert per `typecheck`. 49 Fundstellen,
   unabhängig vom Stream-Protokoll.
2. **Serverseite**, abgesichert durch einen Integrationstest auf `POST /api/chat` gegen einen
   Fake-Provider, der das SSE-Frame-Format prüft. **Dieser Test entsteht vor dem Serverumbau.**
3. **Clientseite**, lokal im Browser gegen den Node-Server, mit echten Keys für Anthropic,
   OpenAI und Google.

Phase 3 geht erst nach GitHub, wenn ein Chat lokal Ende zu Ende durchläuft.

### 6.6 Ausdrücklich nicht Bestandteil von Phase 3

Keine Aktualisierung der `staticModels`-Listen und keine Aktivierung neuer Provider-Features
(Prompt-Caching, Thinking). Der Sprung ist **verhaltensgleich**. Die neuen Fähigkeiten sind
danach verfügbar; sie zu nutzen ist separate Folgearbeit.

## 7. Verifikation und CI

### 7.1 Neue Tests

| Test | Phase | Zweck |
|---|---|---|
| `getServerEnv()` — Auflösungsreihenfolge und Fallback | 1 | Sichert den Kern des Environment-Defekts ab |
| Basic-Auth-Middleware — 401 ohne, Durchlass mit Credentials, `/api/health` immer frei | 1 | Ein Fehler sperrt entweder den Betreiber aus oder niemanden |
| `POST /api/chat` gegen Fake-Provider — SSE-Frame-Format | 3 | Einzige belastbare Absicherung des Stream-Protokolls |

Bewusst nicht mehr: bei drei bestehenden Tests wäre zusätzliche Abdeckung ohne Aussagekraft
reine Beschäftigung.

### 7.2 Docker-Smoke-Test in CI

Der bestehende `docker-validation`-Job wird erweitert:

```
docker build → Container starten (ohne API-Keys, mit BOLT_AUTH_* gesetzt)
  → GET /api/health erwartet 200
  → GET / ohne Credentials erwartet 401
  → GET / mit Credentials erwartet 200 und vorhandene COOP/COEP-Header
  → docker logs auf Fehler prüfen → Container stoppen
```

Das ersetzt lokales Docker weitgehend: derselbe Dockerfile, ein fremder Linux-Host, bei jedem
Push. Auf Coolify bleibt realistisch nur Umgebungsspezifisches (TLS, Domain, Traefik, Environment).

### 7.3 Weitere CI-Änderungen

| Änderung | Grund |
|---|---|
| `setup-and-build`: Node 20.18 → **22**, pnpm 9.14.4 → **10** | Muss dem Dockerfile entsprechen |
| `electron.yml` löschen | Electron entfällt |
| `docker-validation`: neue Stage-Namen + Smoke-Test | Alte Targets existieren nicht mehr |
| `preview.yaml` (Playwright) | Startet via `wrangler`; auf Node-Server umstellen oder deaktivieren |
| `docker.yaml` (GHCR-Publish) behalten | Ermöglicht später ein vorgebautes Image in Coolify |
| `.gitignore`: `*.md` entschärfen | Blockiert heute jedes neue Markdown, auch dieses Dokument |

## 8. Coolify-Konfiguration

- **Application**: Typ Dockerfile, Repo `rscolari79/bolt.diy`, Branch `main`,
  Dockerfile-Pfad `./Dockerfile`.
- **Port**: Container-Port 5173. Der Server liest `process.env.PORT` und folgt Coolify automatisch.
- **Healthcheck**: `/api/health` mit ausreichender `start_period`. Der bisherige Check auf `/`
  rendert die komplette App per SSR und kann bei kaltem Start allein einen Crash-Loop erzeugen.
- **Domain**: zwingend mit TLS. WebContainer benötigt einen Secure Context; über
  `http://ip:5173` startet die Preview-Funktion nicht. Traefik darf
  `Cross-Origin-Opener-Policy: same-origin` und `Cross-Origin-Embedder-Policy: require-corp`
  nicht entfernen.
- **Environment**: alle Werte als normale Runtime-Variablen — `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `BOLT_AUTH_USER`, `BOLT_AUTH_PASSWORD`,
  optional `DEFAULT_NUM_CTX`, `VITE_LOG_LEVEL`. Keine Build-Args, keine `--binding`-Akrobatik,
  keine Allowlist in einer `.d.ts`.
- **Achtung**: `VITE_*`-Variablen werden zur **Build**zeit eingebacken, nicht zur Laufzeit
  gelesen; sie müssen in Coolify als Build-Variable markiert sein.

## 9. Branches und Rückweg

```
main ──┬── feat/node-runtime-coolify      (Phase 1) → Deploy → verifizieren → Merge
       ├── chore/react-router-7-toolchain (Phase 2) → Deploy → verifizieren → Merge
       └── feat/ai-sdk-7                  (Phase 3) → Deploy → verifizieren → Merge
```

Jede Phase wird erst gemergt, wenn sie auf Coolify läuft. Coolify kann jederzeit auf den
vorherigen Commit redeployen. Da nichts gelöscht wird, was die Git-History nicht bewahrt, ist
auch der Weg zurück zu Cloudflare rekonstruierbar.

Lokale Verifikation vor jedem Push: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm build`
und ein laufender Node-Server auf localhost. `pnpm` wird per `corepack` bereitgestellt.

## 10. Offene Voraussetzungen

- **Push-Zugang zu GitHub** (Blocker für Schritt 4). Aktuell: SSH `Permission denied (publickey)`,
  kein `gh`, keine Git-Identität. Vorgesehen: `brew install gh` und `gh auth login` (interaktiv
  durch den Betreiber), alternativ ein Personal Access Token mit `repo`-Scope in einem lokalen
  Credential-Store. Git-Identität: `rscolari79` / `ros@cyon.ch`.
- **API-Keys für Anthropic, OpenAI und Google** — erst für die Verifikation von Phase 3.

## 11. Reihenfolge

1. Design-Dokument gegenlesen (dieses Dokument).
2. Implementationsplan für Phase 1 erstellen.
3. Phase 1 lokal implementieren und verifizieren.
4. GitHub-Zugang einrichten, pushen, CI baut und smoke-testet das Image.
5. Gemeinsam auf Coolify deployen.
6. Phase 2, danach Phase 3 im selben Muster.
