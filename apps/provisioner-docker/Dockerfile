# syntax=docker/dockerfile:1

# "Build outside Docker, ingest dist": `shipfox-docker --setup-context` prunes
# the workspace and overlays the turbo-cached dist/. The build stage installs
# the pruned workspace and runs `pnpm deploy` to extract the provisioner's
# production dependency closure into a self-contained tree; the runtime stage
# ships only that, so Docker never compiles TypeScript.

ARG NODE_VERSION=24.16.0
ARG PNPM_VERSION=11.6.0

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
    pnpm --filter=@shipfox/provisioner-docker deploy --prod --legacy \
      --store-dir=/pnpm/store --config.strict-peer-dependencies=false /prod

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /prod ./

# The Docker provisioner usually talks to a mounted Docker socket. Running as root
# avoids requiring deployments to align the container user with the host socket's
# group id; remote Docker hosts can still be selected with SHIPFOX_PROVISIONER_DOCKER_HOST.

# The build/promotion workflows pass revision/created as build args.
ARG IMAGE_SOURCE="https://github.com/ShipfoxHQ/shipfox"
ARG IMAGE_REVISION
ARG IMAGE_CREATED
LABEL org.opencontainers.image.title="@shipfox/provisioner-docker" \
      org.opencontainers.image.description="Shipfox Docker provisioner" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED

# --enable-source-maps maps stack traces back to TypeScript.
CMD ["node", "--enable-source-maps", "./dist/index.js"]
