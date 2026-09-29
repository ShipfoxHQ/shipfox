import {bool, createConfig, str} from '@shipfox/config';
import {findInvalidLabels, MAX_RUNNER_LABELS, parseLabelList} from '@shipfox/runner-labels';

export const config = createConfig({
  DEFINITION_DEFAULT_RUNNER_LABEL: str({
    desc: 'Default runner label(s) applied to workflow jobs that do not declare a "runner" at the job or workflow level. Set it to a comma-separated list, for example ubuntu-latest or ubuntu-latest,node-22. Leave it empty to require every workflow job to declare runner labels explicitly; with no value set, a job without a runner fails definition validation.',
    default: '',
  }),
  DEFINITION_ACTIONS_ENABLED: bool({
    desc: 'Whether workflow steps can run repository actions with `uses`. Use true or false. Defaults to false; local development defaults to true. When false, a workflow with a `uses` step fails validation with "not supported yet".',
    default: false,
    devDefault: true,
  }),
  REGISTRY_URL: str({
    desc: 'URL of the Shipfox Registry API, such as https://api.registry.shipfox.io. When it is set and DEFINITION_ACTIONS_ENABLED is on, workflow steps can run registry actions with `uses: namespace/name@1.4.2`. Leave it empty to accept repository actions only. The registry module reads the same variable.',
    default: '',
  }),
  DEFINITION_WORKFLOW_PATH: str({
    desc: 'Repository-relative path that contains workflow YAML files. Set a different path for each Shipfox instance when staging and production share a repository.',
    default: '.shipfox/workflows/',
  }),
});

export function parseDefinitionDefaultRunnerLabels(value: string): readonly string[] {
  const labels = parseLabelList(value);
  const invalid = findInvalidLabels(labels);

  if (invalid.length > 0) {
    throw new Error(
      `DEFINITION_DEFAULT_RUNNER_LABEL contains invalid runner label(s): ${invalid.join(', ')}`,
    );
  }

  if (labels.length > MAX_RUNNER_LABELS) {
    throw new Error(
      `DEFINITION_DEFAULT_RUNNER_LABEL contains ${labels.length} runner labels; the maximum is ${MAX_RUNNER_LABELS}`,
    );
  }

  return labels;
}

export const definitionDefaultRunnerLabels = parseDefinitionDefaultRunnerLabels(
  config.DEFINITION_DEFAULT_RUNNER_LABEL,
);

export const definitionWorkflowPath = config.DEFINITION_WORKFLOW_PATH;

export const definitionActionsEnabled = config.DEFINITION_ACTIONS_ENABLED;

export const definitionRegistryActionsEnabled =
  config.DEFINITION_ACTIONS_ENABLED && config.REGISTRY_URL.trim() !== '';
