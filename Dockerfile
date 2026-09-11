# syntax=docker/dockerfile:1

# ---- Stage: deps — alle Dependencies, inklusive dev (für den Build nötig) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app

ENV HUSKY=0 \
    CI=true

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch

# Keine --ignore-scripts hier: manche Pakete richten in Postinstall-Skripten
# ihre Plattform-Binaries ein. Husky ist über HUSKY=0 bereits neutralisiert,
# und es gibt im Build-Kontext ohnehin kein .git-Verzeichnis.
RUN pnpm install --offline --frozen-lockfile

# ---- Stage: build — Quellcode bauen ----
FROM deps AS build
WORKDIR /app

# Versionsstempel, damit die App zur Laufzeit kein .git-Verzeichnis braucht
ARG BOLT_APP_VERSION=unknown
ARG BOLT_APP_BRANCH=unknown
ENV BOLT_APP_VERSION=${BOLT_APP_VERSION} \
    BOLT_APP_BRANCH=${BOLT_APP_BRANCH}

# VITE_*-Variablen werden zur Buildzeit eingebacken, nicht zur Laufzeit gelesen
ARG VITE_LOG_LEVEL=debug
ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL}

COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# ---- Stage: prod-deps — nur Produktions-Dependencies ----
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
#
# --chown direkt beim Kopieren statt "RUN chown -R /app" danach: Letzteres
# erzeugt eine zusätzliche Layer, die node_modules vollständig dupliziert. Bei
# den Produktions-Dependencies sind das mehrere hundert Megabyte plus pnpms
# Symlink-Struktur — es verdoppelt die Imagegrösse und liess das
# Coolify-Deployment in den Job-Timeout laufen.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/build        ./build
COPY                  --chown=node:node server            ./server
COPY                  --chown=node:node package.json      ./package.json

USER node

EXPOSE 5173

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.mjs"]
