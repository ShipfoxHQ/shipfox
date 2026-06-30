import {logger} from '@shipfox/node-opentelemetry';
import {loggingLaunch, startProvisioner} from '@shipfox/provisioner-core';
import {config} from '#config.js';
import {type DockerTemplateSpec, loadDockerTemplates} from '#templates.js';

/**
 * Start the Docker provisioner: load and validate the local Docker templates, then run
 * the provider-agnostic control loop against them with the configured launcher.
 */
export function startDockerProvisioner(): Promise<void> {
  // This launcher reserves demand and mints registration tokens but does not start
  // containers, so it must not be pointed at a production API.
  logger().warn(
    'Docker provisioner is running with a logging launcher: it reserves demand and mints registration tokens but does NOT start runner containers. Do not run it against a production API.',
  );
  return startProvisioner<DockerTemplateSpec>({
    adapter: {
      loadTemplates: () =>
        Promise.resolve(loadDockerTemplates(config.SHIPFOX_PROVISIONER_TEMPLATES_FILE)),
      launch: loggingLaunch,
    },
  });
}
