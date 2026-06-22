# syntax=docker/dockerfile:1

# Unlike the api/runner images there is no prune and no node_modules: the client
# is a static artifact built outside Docker by `turbo build` (dist/). Docker only
# assembles. The API endpoint is NOT baked at build time; an entrypoint script
# rewrites /config.js from environment at container start, so one image serves
# any self-hosted deployment without a rebuild.

ARG NGINX_VERSION=1.29

FROM nginx:${NGINX_VERSION}-alpine

# SPA routing + cache headers. Rarely changes, so copy before dist/ to keep the
# layer cached across builds.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The stock nginx entrypoint runs every executable /docker-entrypoint.d/*.sh
# before starting nginx; ours rewrites config.js from env on each container start.
COPY docker-entrypoint.d/ /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/*.sh

# The Vite build output (built outside Docker by `turbo build`). Changes most, so
# copy last.
COPY dist/ /usr/share/nginx/html/

# The build/promotion workflows pass revision/created as build args.
ARG IMAGE_SOURCE="https://github.com/ShipfoxHQ/shipfox"
ARG IMAGE_REVISION
ARG IMAGE_CREATED
LABEL org.opencontainers.image.title="@shipfox/client" \
      org.opencontainers.image.description="Shipfox web client" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED

# The base image already sets the entrypoint (runs docker-entrypoint.d/ then
# nginx) and the CMD, so neither is repeated here.
