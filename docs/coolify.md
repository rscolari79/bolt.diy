# bolt.diy auf Coolify betreiben

Diese Instanz läuft in Produktion als normaler Node-Prozess (`server/index.mjs`,
Express + Remix), nicht auf Cloudflare Workers. Es gibt weder `wrangler` noch
`bindings.sh` noch eine `worker-configuration.d.ts`.

## Application anlegen

| Feld | Wert |
|---|---|
| Typ | **Dockerfile** (Git-Repository mit Build-Pack `dockerfile`) |
| Repository | dieser Fork |
| Branch | `main` |
| Dockerfile-Pfad | `./Dockerfile` |
| Build-Target | `runtime` |

## Port und Healthcheck

- **Container-Port: 5173.** Der Server liest `PORT` aus der Umgebung und folgt
  Coolify automatisch, falls dort ein anderer Wert gesetzt ist.
- **Healthcheck-Pfad: `/api/health`**, mit einer `start_period` von mindestens
  30 Sekunden.

Der Healthcheck ist wichtiger, als er aussieht: ein Check auf `/` rendert die
komplette Anwendung per SSR. Bei kaltem Start dauert das lange genug, dass die
Plattform den Container für ungesund erklärt und neu startet — ein Crash-Loop,
obwohl die Anwendung einwandfrei läuft. `/api/health` antwortet dagegen ohne
Rendering und ohne Authentisierung.

## Domain und TLS — nicht optional

Die Domain **muss** ein TLS-Zertifikat haben. WebContainer, die Laufzeit für die
Vorschau im Browser, benötigt einen Secure Context. Über `http://<ip>:5173`
startet die Vorschau nicht, auch wenn der Server fehlerfrei läuft.

Zusätzlich darf der Reverse Proxy diese beiden Header nicht entfernen:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Ohne sie bleibt WebContainer tot. Prüfen lässt sich das am laufenden Deployment:

```bash
curl -sS -D - -o /dev/null https://<deine-domain>/ | grep -i cross-origin
```

Erwartet werden beide Zeilen. Der CI-Smoke-Test stellt sicher, dass der Server
sie sendet; dass sie durch Traefik ankommen, zeigt nur dieser Aufruf.

## Environment-Variablen

Alles wird als normale Runtime-Variable gesetzt — keine Build-Args, keine
Allowlist in einer Typdeklaration:

| Variable | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic-Modelle |
| `OPENAI_API_KEY` | OpenAI-Modelle |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google-Modelle |
| `BOLT_AUTH_USER` | Basic-Auth-Benutzername |
| `BOLT_AUTH_PASSWORD` | Basic-Auth-Passwort |
| `DEFAULT_NUM_CTX` | optional, Standard 32768 |
| `PORT` | optional, Standard 5173 |

Weitere Provider-Keys stehen in `.env.example`. Sie müssen nirgends registriert
werden: die Prozessumgebung erreicht die Anwendung vollständig.

### Zugriffsschutz

bolt.diy hat **keine eigene Benutzerverwaltung**. Wer die URL kennt, kann
Modelle auf Kosten der hinterlegten Keys abfragen. Setze deshalb
`BOLT_AUTH_USER` und `BOLT_AUTH_PASSWORD`, sobald serverseitige API-Keys
konfiguriert sind. Sind beide leer, läuft die Instanz bewusst ungeschützt —
das ist nur sinnvoll, wenn sie nicht öffentlich erreichbar ist oder die Nutzer
eigene Keys über die Bolt-Einstellungen mitbringen.

Die Authentisierung schützt auch die statischen Assets. Das bricht die
WebContainer-Vorschau nicht, weil Browser die Credentials bei jedem
Subrequest mitschicken.

### `VITE_*`-Variablen sind die Ausnahme

Variablen mit dem Präfix `VITE_` werden zur **Buildzeit** in das Artefakt
eingebacken und zur Laufzeit nicht gelesen. In Coolify müssen sie als
Build-Variable markiert sein, sonst haben sie keine Wirkung. Das betrifft unter
anderem `VITE_LOG_LEVEL` und `VITE_GITHUB_ACCESS_TOKEN`.

Der Grund dahinter ist zugleich eine Falle, die man kennen sollte: im
Vite-Bundle ist `process.env` ein statischer Schnappschuss der Buildzeit, weil
`vite-plugin-node-polyfills` das `process`-Global ersetzt. Deshalb übergibt
`server/index.mjs` die echte Prozessumgebung über den Remix-Load-Context, und
Anwendungscode liest sie ausschliesslich über `getServerEnv(context)` aus
`app/lib/.server/env.ts`. Wer dort künftig direkt `process.env` verwendet, baut
sich lautlos einen Fehler ein.

## Verifikation nach dem Deployment

```bash
# 1. Healthcheck, ohne Credentials erreichbar
curl -sS -o /dev/null -w '%{http_code}\n' https://<domain>/api/health          # 200

# 2. Auth greift
curl -sS -o /dev/null -w '%{http_code}\n' https://<domain>/                    # 401
curl -sS -o /dev/null -w '%{http_code}\n' -u user:pass https://<domain>/       # 200

# 3. Cross-Origin-Isolation kommt durch den Proxy
curl -sS -D - -o /dev/null -u user:pass https://<domain>/ | grep -i cross-origin

# 4. Version stimmt mit dem Deployment überein
curl -sS -u user:pass https://<domain>/api/git-info
```

Schlägt Punkt 3 fehl, lädt die Anwendung, aber die Vorschau bleibt leer. Das ist
der erfahrungsgemäss häufigste Fehler bei diesem Setup, und er sieht nicht nach
einem Proxy-Problem aus.
