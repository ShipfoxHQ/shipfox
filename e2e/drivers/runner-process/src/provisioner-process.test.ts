import {config} from '@shipfox/e2e-core';
import {
  buildProvisionerContainerCommand,
  buildProvisionerEnv,
  type StartProvisionerParams,
} from './provisioner-process.js';

const IMAGE = 'ghcr.io/shipfoxhq/provisioner-docker@sha256:abc';
const CONTAINER_NAME = 'shipfox-e2e-provisioner-test';

function params(overrides: Partial<StartProvisionerParams> = {}): StartProvisionerParams {
  return {
    workspaceId: 'workspace-1',
    userToken: 'user-token',
    provisionerToken: 'provisioner-token',
    templatesFile: '/suite/templates.e2e.yaml',
    logFile: '/suite/provisioner.log',
    apiUrl: 'http://localhost:3000',
    ...overrides,
  };
}

describe('buildProvisionerEnv', () => {
  test('passes the host API URL and leaves the runner networking unset in source mode', () => {
    const env = buildProvisionerEnv(params());

    expect(env).toEqual({
      SHIPFOX_API_URL: 'http://localhost:3000',
      SHIPFOX_PROVISIONER_TOKEN: 'provisioner-token',
      SHIPFOX_PROVISIONER_TEMPLATES_FILE: '/suite/templates.e2e.yaml',
    });
  });

  test('passes the runner networking values the caller sets in source mode', () => {
    const env = buildProvisionerEnv(
      params({
        runnerApiUrl: 'http://host.docker.internal:3000',
        dockerNetwork: 'shipfox_default',
        dockerExtraHosts: 'host.docker.internal:host-gateway',
      }),
    );

    expect(env).toMatchObject({
      SHIPFOX_RUNNER_API_URL: 'http://host.docker.internal:3000',
      SHIPFOX_PROVISIONER_DOCKER_NETWORK: 'shipfox_default',
      SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS: 'host.docker.internal:host-gateway',
    });
  });
});

describe('buildProvisionerContainerCommand', () => {
  test('mounts the Docker socket and the templates file and maps the host gateway', () => {
    const {args} = buildProvisionerContainerCommand(
      params({mode: 'image', image: IMAGE}),
      CONTAINER_NAME,
    );

    expect(args).toEqual([
      'run',
      '--rm',
      '--name',
      CONTAINER_NAME,
      '--add-host',
      'host.docker.internal:host-gateway',
      '--volume',
      '/var/run/docker.sock:/var/run/docker.sock',
      '--volume',
      '/suite/templates.e2e.yaml:/etc/shipfox/templates.yaml:ro',
      '--env',
      'SHIPFOX_API_URL',
      '--env',
      'SHIPFOX_RUNNER_API_URL',
      '--env',
      'SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS',
      '--env',
      'SHIPFOX_PROVISIONER_TOKEN',
      '--env',
      'SHIPFOX_PROVISIONER_TEMPLATES_FILE',
      IMAGE,
    ]);
  });

  test('points the provisioner and its runners at the host through host.docker.internal', () => {
    const {env} = buildProvisionerContainerCommand(
      params({mode: 'image', image: IMAGE}),
      CONTAINER_NAME,
    );

    expect(env).toEqual({
      SHIPFOX_API_URL: 'http://host.docker.internal:3000',
      SHIPFOX_RUNNER_API_URL: 'http://host.docker.internal:3000',
      SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS: 'host.docker.internal:host-gateway',
      SHIPFOX_PROVISIONER_TOKEN: 'provisioner-token',
      SHIPFOX_PROVISIONER_TEMPLATES_FILE: '/etc/shipfox/templates.yaml',
    });
  });

  test('derives the container API URL from the E2E API URL when none is given', () => {
    const expected = new URL(config.API_URL);
    expected.hostname = 'host.docker.internal';

    const {apiUrl: _, ...withoutApiUrl} = params({mode: 'image', image: IMAGE});

    const {env} = buildProvisionerContainerCommand(withoutApiUrl, CONTAINER_NAME);

    expect(new URL(env.SHIPFOX_API_URL ?? '').href).toBe(expected.href);
  });

  test('applies the networking overrides the caller sets', () => {
    const {args, env} = buildProvisionerContainerCommand(
      params({
        mode: 'image',
        image: IMAGE,
        containerApiUrl: 'http://api:3000',
        runnerApiUrl: 'http://api.internal:3000',
        dockerExtraHosts: 'api.internal:10.0.0.2',
        dockerNetwork: 'shipfox_default',
      }),
      CONTAINER_NAME,
    );

    expect(env).toMatchObject({
      SHIPFOX_API_URL: 'http://api:3000',
      SHIPFOX_RUNNER_API_URL: 'http://api.internal:3000',
      SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS: 'api.internal:10.0.0.2',
      SHIPFOX_PROVISIONER_DOCKER_NETWORK: 'shipfox_default',
    });
    expect(args).toContain('SHIPFOX_PROVISIONER_DOCKER_NETWORK');
  });

  test('keeps the provisioner token out of the docker arguments', () => {
    const {args} = buildProvisionerContainerCommand(
      params({mode: 'image', image: IMAGE}),
      CONTAINER_NAME,
    );

    expect(args.join(' ')).not.toContain('provisioner-token');
  });

  test.each([
    'http://localhost:3000',
    'http://api.localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('refuses the loopback container API URL %s', (containerApiUrl) => {
    const build = () =>
      buildProvisionerContainerCommand(
        params({mode: 'image', image: IMAGE, containerApiUrl}),
        CONTAINER_NAME,
      );

    expect(build).toThrow('loopback');
  });

  test('requires an image', () => {
    const build = () => buildProvisionerContainerCommand(params({mode: 'image'}), CONTAINER_NAME);

    expect(build).toThrow('image');
  });
});
