# syntax=docker/dockerfile:1

# "Build outside Docker, ingest the output": `turbo build` runs `next build`
# with `output: 'standalone'`, which traces the server and the workspace
# packages it needs into .next/standalone. Docker only assembles that tree, so
# there is no prune and no install. The registry API URL is read at runtime
# (REGISTRY_URL), so one image serves any registry.

ARG NODE_VERSION=24.16.0

FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN groupadd --system shipfox \
    && useradd --system --gid shipfox --no-create-home shipfox

# The traced server keeps the monorepo layout: the app lives at
# apps/registry-client next to its node_modules.
COPY .next/standalone/ ./
# Static assets are not part of the standalone trace.
COPY .next/static/ ./apps/registry-client/.next/static/
# Next.js writes revalidated pages and cached fetches under .next/cache at runtime.
RUN mkdir -p ./apps/registry-client/.next/cache \
    && chown shipfox:shipfox ./apps/registry-client/.next/cache

USER shipfox

EXPOSE 3000

# The build/promotion workflows pass revision/created as build args.
ARG IMAGE_SOURCE="https://github.com/ShipfoxHQ/shipfox"
ARG IMAGE_REVISION
ARG IMAGE_CREATED
LABEL org.opencontainers.image.title="@shipfox/registry-client" \
      org.opencontainers.image.description="Shipfox Registry front-end" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED

CMD ["node", "apps/registry-client/server.js"]
