import {parseDefinitionDefaultRunnerLabels} from './config.js';

const defaultRunnerLabelEnvPattern = /DEFINITION_DEFAULT_RUNNER_LABEL/;

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
