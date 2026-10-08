# syntax=docker/dockerfile:1

# The job container image of tests/job-container.e2e.ts. The base image has neither
# Git nor the Docker CLI, so a step that uses them proves it ran in this image.
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl git \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install --yes --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# Exists only in this image.
COPY --chmod=0755 shipfox-e2e-toolbox /usr/local/bin/shipfox-e2e-toolbox
