# syntax=docker/dockerfile:1

# "Build outside Docker, ingest dist": `shipfox-docker --setup-context` prunes
# the workspace and overlays the turbo-cached dist/. The build stage installs
# the pruned workspace and runs `pnpm deploy` to extract @shipfox/api's
# production dependency closure into a self-contained tree; the runtime stage
# ships only that, so the dev-only tools/* workspace packages (biome, vitest,
# the swc/playwright toolchains) never reach the image. Docker never compiles
# TypeScript.

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
COPY out/json/ ./
COPY out/full/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@shipfox/api deploy --prod --legacy \
      --store-dir=/pnpm/store --config.strict-peer-dependencies=false /prod

FROM base AS runtime
ENV NODE_ENV=production

# Run unprivileged: the service only reads its own files and never writes them.
RUN groupadd --system shipfox && useradd --system --gid shipfox --no-create-home shipfox

COPY --from=build /prod ./

USER shipfox

# The build/promotion workflows pass revision/created as build args.
ARG IMAGE_SOURCE="https://github.com/ShipfoxHQ/shipfox"
ARG IMAGE_REVISION
ARG IMAGE_CREATED
LABEL org.opencontainers.image.title="@shipfox/api" \
      org.opencontainers.image.description="Shipfox API" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED

# --enable-source-maps maps stack traces back to TypeScript; --import preloads
# Sentry (error-monitoring/init) before the app graph loads. OpenTelemetry is
# started in-process by run(), so it needs no preload flag. The flags stay on the
# entrypoint command (not NODE_OPTIONS) so they apply to the app only, not to any
# other node process run inside the container.
CMD ["node", "--enable-source-maps", "--import", "@shipfox/node-error-monitoring/init", "./dist/index.js"]
