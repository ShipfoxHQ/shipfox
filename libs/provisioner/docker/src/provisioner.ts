import {startProvisioner} from '@shipfox/provisioner-core';
import {config} from '#config.js';
import {createDockerEngine} from '#docker-engine.js';
import {createDockerLifecycle, type DockerLifecycle} from '#lifecycle.js';
import {type DockerTemplateSpec, loadDockerTemplates} from '#templates.js';

/**
 * Start the Docker provisioner: load and validate the local Docker templates, then run
 * the provider-agnostic control loop against them with the configured launcher.
 */
export function startDockerProvisioner(): Promise<void> {
  const templates = loadDockerTemplates(config.SHIPFOX_PROVISIONER_TEMPLATES_FILE);
  const engine = createDockerEngine({
    ...(config.SHIPFOX_PROVISIONER_DOCKER_HOST
      ? {host: config.SHIPFOX_PROVISIONER_DOCKER_HOST}
      : {}),
    ...(config.SHIPFOX_PROVISIONER_DOCKER_NETWORK
      ? {network: config.SHIPFOX_PROVISIONER_DOCKER_NETWORK}
      : {}),
  });
  let lifecycle: DockerLifecycle | undefined;

  return startProvisioner<DockerTemplateSpec>({
    adapter: {
      loadTemplates: () => Promise.resolve(templates),
      launch: (launch) => {
        if (!lifecycle) throw new Error('Docker lifecycle has not been initialized.');
        return lifecycle.launch(launch);
      },
      async onStart(runtime) {
        lifecycle = createDockerLifecycle({
          engine,
          client: runtime.client,
          identity: runtime.identity,
          tracker: runtime.tracker,
          templates,
          registrationDeadlineMs: config.SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS,
          providerKind: 'docker',
        });
        await lifecycle.reconcile();
      },
      onTick() {
        if (!lifecycle) throw new Error('Docker lifecycle has not been initialized.');
        return lifecycle.observe();
      },
      onStop() {
        return lifecycle?.flush() ?? Promise.resolve();
      },
    },
  });
}
