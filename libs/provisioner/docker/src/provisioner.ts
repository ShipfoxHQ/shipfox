import {logger} from '@shipfox/node-opentelemetry';
import {loggingLaunch, startProvisioner} from '@shipfox/provisioner-core';
import {config} from '#config.js';
import {type DockerTemplateSpec, loadDockerTemplates} from '#templates.js';

/**
 * Start the Docker provisioner: load and validate the local Docker templates, then run
 * the provider-agnostic control loop against them. ENG-617 wires the logging launcher;
 * the launcher that actually runs containers replaces it in ENG-618.
 */
export function startDockerProvisioner(): Promise<void> {
  // Loud, deliberate: this build reserves demand and mints registration tokens but does
  // not start any container yet, so it must not be pointed at a production API.
  logger().warn(
    'Docker provisioner is running with a logging launcher (ENG-617): it reserves demand and mints registration tokens but does NOT start runner containers. Do not run it against a production API until ENG-618 lands the real launcher.',
  );
  return startProvisioner<DockerTemplateSpec>({
    adapter: {
      loadTemplates: () =>
        Promise.resolve(loadDockerTemplates(config.SHIPFOX_PROVISIONER_TEMPLATES_FILE)),
      launch: loggingLaunch,
    },
  });
}
