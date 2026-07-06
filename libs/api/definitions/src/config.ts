import {
  type HarnessToolDeploymentConfig,
  type HarnessToolPackageName,
  PI_HARNESS_TOOL_PACKAGE_NAMES,
} from '@shipfox/api-agent-dto';
import {bool, createConfig, str} from '@shipfox/config';
import {findInvalidLabels, MAX_RUNNER_LABELS, parseLabelList} from '@shipfox/runner-labels';

const piHarnessToolPackageNames = new Set<string>(PI_HARNESS_TOOL_PACKAGE_NAMES);

export const config = createConfig({
  DEFINITION_DEFAULT_RUNNER_LABEL: str({
    desc: 'Default runner label(s) applied to workflow jobs that do not declare a "runner" at the job or workflow level. Set it to a comma-separated list, for example ubuntu-latest or ubuntu-latest,node-22. Leave it empty to require every workflow job to declare runner labels explicitly; with no value set, a job without a runner fails definition validation.',
    default: '',
  }),
  AGENT_PI_ENABLED_TOOL_PACKAGES: str({
    desc: 'Comma-separated optional Pi tool packages enabled for this deployment. Defaults to pi-web-access so Pi web access is available. Set it to an empty value to enable only Pi built-in tools. Accepted values: pi-web-access.',
    default: 'pi-web-access',
  }),
  AGENT_PI_WEB_SEARCH_ENABLED: bool({
    desc: 'Enables Pi web search tools when pi-web-access is enabled. Set it to false to disable web_search and get_search_content while keeping fetch_content available.',
    default: true,
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

export const definitionHarnessToolDeploymentConfig: HarnessToolDeploymentConfig = {
  pi: {
    enabledToolPackages: parsePiEnabledToolPackages(config.AGENT_PI_ENABLED_TOOL_PACKAGES),
    webSearchEnabled: config.AGENT_PI_WEB_SEARCH_ENABLED,
  },
  claude: {
    enabledToolPackages: [],
  },
};

export function parsePiEnabledToolPackages(value: string): HarnessToolPackageName[] {
  const packageNames = value
    .split(',')
    .map((packageName) => packageName.trim())
    .filter((packageName) => packageName.length > 0);

  const invalidPackageNames = packageNames.filter(
    (packageName) => !piHarnessToolPackageNames.has(packageName),
  );
  if (invalidPackageNames.length > 0) {
    throw new Error(
      `AGENT_PI_ENABLED_TOOL_PACKAGES contains unsupported package(s): ${invalidPackageNames.join(
        ', ',
      )}. Accepted values: ${PI_HARNESS_TOOL_PACKAGE_NAMES.join(', ')}.`,
    );
  }

  return [...new Set(packageNames)] as HarnessToolPackageName[];
}
