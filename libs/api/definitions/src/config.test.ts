import {parseDefinitionDefaultRunnerLabels, parsePiEnabledToolPackages} from './config.js';

const defaultRunnerLabelEnvPattern = /DEFINITION_DEFAULT_RUNNER_LABEL/;
const piToolPackagesEnvPattern = /AGENT_PI_ENABLED_TOOL_PACKAGES/;

describe('parseDefinitionDefaultRunnerLabels', () => {
  it('canonicalizes comma-delimited default runner labels', () => {
    const labels = parseDefinitionDefaultRunnerLabels(' Ubuntu-Latest,node-22,ubuntu-latest ');

    expect(labels).toEqual(['node-22', 'ubuntu-latest']);
  });

  it('rejects invalid configured runner labels with the env var name', () => {
    expect(() => parseDefinitionDefaultRunnerLabels('has space')).toThrow(
      defaultRunnerLabelEnvPattern,
    );
  });

  it('rejects too many configured runner labels with the env var name', () => {
    const value = Array.from({length: 21}, (_, index) => `label-${index}`).join(',');

    expect(() => parseDefinitionDefaultRunnerLabels(value)).toThrow(defaultRunnerLabelEnvPattern);
  });
});

describe('parsePiEnabledToolPackages', () => {
  it('deduplicates comma-delimited Pi tool package names', () => {
    const packageNames = parsePiEnabledToolPackages(' pi-web-access,pi-web-access ');

    expect(packageNames).toEqual(['pi-web-access']);
  });

  it('allows an empty package list', () => {
    const packageNames = parsePiEnabledToolPackages('');

    expect(packageNames).toEqual([]);
  });

  it('rejects unknown package names with the env var name', () => {
    expect(() => parsePiEnabledToolPackages('pi-web-access,unknown')).toThrow(
      piToolPackagesEnvPattern,
    );
  });
});
