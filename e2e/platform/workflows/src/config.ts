import {createConfig, str} from '@shipfox/config';
import {config as e2eCoreConfig} from '@shipfox/e2e-core';

export const config = createConfig({
  E2E_DOCKER_NETWORK: str({
    desc: 'Docker network the provisioner attaches runner containers to, so they can reach gitea and the host API. Locally this is the network docker compose creates, named "<repo-dir>_default". In CI, pin COMPOSE_PROJECT_NAME=shipfox and set this to "shipfox_default". Required, with no default.',
  }),
  E2E_RUNNER_IMAGE: str({
    desc: 'Docker image the provisioner launches for runner containers. Defaults to runner:ci, the tag "turbo image --filter=@shipfox/runner" loads locally and in CI. Point it at a published image to run the suite against a released runner.',
    default: 'runner:ci',
  }),
  E2E_API_HOST_FROM_CONTAINER: str({
    desc: 'Host a runner container uses to reach the API, which runs on the host. Defaults to host.docker.internal, resolved through the host-gateway mapping the provisioner adds to each runner container.',
    default: 'host.docker.internal',
  }),
});

const TRAILING_SLASH_RE = /\/$/;

// The API is a host process, so a runner container reaches it through the
// container-facing host (host.docker.internal) with the same scheme and port the
// tests use. Trailing slash stripped so the runner joins path segments cleanly.
export function runnerApiUrl(): string {
  const url = new URL(e2eCoreConfig.API_URL);
  url.hostname = config.E2E_API_HOST_FROM_CONTAINER;
  return url.toString().replace(TRAILING_SLASH_RE, '');
}
