# syntax=docker/dockerfile:1

# "Build outside Docker, ingest dist": `shipfox-docker --setup-context` prunes
# the workspace and overlays the turbo-cached dist/. The build stage installs
# @shipfox/api's production dependency closure into the pruned workspace and the
# runtime stage ships that workspace. Docker never compiles TypeScript.

ARG NODE_VERSION=24.16.0
ARG PNPM_VERSION=11.6.0

# Debian (glibc), not Alpine (musl): @temporalio/core-bridge ships only glibc
# (`*-linux-gnu`) native prebuilds, so it fails to load on musl.
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS build
# Manifests + lockfile first (out/full carries the source but not the lockfile).
# The frozen install keeps the image on the graph pnpm-lock.yaml records, with one
# installed copy of each workspace package. `pnpm deploy` would resolve workspace
# packages and their peers again, which can give a package a second copy with its
# own classes and module state. --filter-prod limits the install to @shipfox/api's
# production closure, so the dev-only tools/* workspace packages get no
# node_modules.
COPY out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter-prod=@shipfox/api... \
      --store-dir=/pnpm/store
# The built workspace packages, with manifests whose imports point at dist/.
COPY out/full/ ./

FROM base AS runtime
ENV NODE_ENV=production

# Install the OS trust store for native TLS clients, then run unprivileged.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system shipfox \
    && useradd --system --gid shipfox --no-create-home shipfox

COPY --from=build /app ./
# Node resolves the app's dependencies, and any --import specifier, from the
# app package, so run from there rather than the workspace root.
WORKDIR /app/apps/api
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/shipfox-entrypoint

USER shipfox

EXPOSE 9464 9465 9474

# The build/promotion workflows pass revision/created as build args.
ARG IMAGE_SOURCE="https://github.com/ShipfoxHQ/shipfox"
ARG IMAGE_REVISION
ARG IMAGE_CREATED
LABEL org.opencontainers.image.title="@shipfox/api" \
      org.opencontainers.image.description="Shipfox API" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED \
      io.shipfox.compatibility.env-file="SHIPFOX_ENV_FILE"

# --enable-source-maps maps stack traces back to TypeScript. The two --import
# flags preload OpenTelemetry then Sentry before the app graph loads.
# The @shipfox/api-server/instrumentation preload must run first: the metrics API has no proxy
# meter, so any instrument created at import time binds to a no-op provider unless the SDK has
# already registered the global meter provider. The flags stay on the entrypoint
# command (not NODE_OPTIONS) so they apply to the app only, not to any other node
# process run inside the container.
ENTRYPOINT ["shipfox-entrypoint"]
CMD ["node", "--enable-source-maps", "--import", "@shipfox/api-server/instrumentation", "--import", "@shipfox/node-error-monitoring/init", "./dist/index.js"]
