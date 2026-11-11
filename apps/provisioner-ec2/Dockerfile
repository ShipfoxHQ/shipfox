# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.16.0
ARG PNPM_VERSION=11.6.0

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
# own classes and module state. --filter-prod limits the install to @shipfox/provisioner-ec2's
# production closure, so the dev-only tools/* workspace packages get no
# node_modules.
COPY out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter-prod=@shipfox/provisioner-ec2... \
      --store-dir=/pnpm/store
# The built workspace packages, with manifests whose imports point at dist/.
COPY out/full/ ./

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app ./
# Node resolves the app's dependencies, and any --import specifier, from the
# app package, so run from there rather than the workspace root.
WORKDIR /app/apps/provisioner-ec2

ARG IMAGE_SOURCE="https://github.com/ShipfoxHQ/shipfox"
ARG IMAGE_REVISION
ARG IMAGE_CREATED
LABEL org.opencontainers.image.title="@shipfox/provisioner-ec2" \
      org.opencontainers.image.description="Shipfox EC2 provisioner" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED

CMD ["node", "--enable-source-maps", "./dist/index.js"]
