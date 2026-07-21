# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.16.0
ARG PNPM_VERSION=11.6.0

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS build
COPY out/json/ ./
COPY out/full/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@shipfox/provisioner-ec2 deploy --prod --legacy \
      --store-dir=/pnpm/store --config.strict-peer-dependencies=false /prod

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /prod ./

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
