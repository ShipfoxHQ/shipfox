import {loggingLaunch, startProvisioner} from '@shipfox/provisioner-core';
import {config} from '#config.js';
import {type DockerTemplateSpec, loadDockerTemplates} from '#templates.js';

/**
 * Start the Docker provisioner: load and validate the local Docker templates, then run
 * the provider-agnostic control loop against them. ENG-617 wires the logging launcher;
 * the launcher that actually runs containers replaces it in ENG-618.
 */
export function startDockerProvisioner(): Promise<void> {
  return startProvisioner<DockerTemplateSpec>({
    adapter: {
      loadTemplates: () =>
        Promise.resolve(loadDockerTemplates(config.SHIPFOX_PROVISIONER_TEMPLATES_FILE)),
      launch: loggingLaunch,
    },
  });
}
