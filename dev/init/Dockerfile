# Tools for the garage-init and gitea-init bootstrap scripts. Baked into a shared local image so
# workspace setup does not download packages on every run. Bump the tag in compose.yml when
# this file changes; compose reuses an existing image with the same tag.
FROM alpine:3.24
RUN apk add --no-cache curl jq
