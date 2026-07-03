import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverScenarios} from './scenarios.js';

function createTempScenariosRoot(): string {
  return mkdtempSync(join(tmpdir(), 'shipfox-e2e-scenarios-'));
}

function writeScenarioFile(root: string, scenario: string, file: string, content: string): void {
  const dir = join(root, scenario);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, file), content);
}

describe('discoverScenarios', () => {
  test('loads directories that contain expect.yaml and workflow.yml', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'hello', 'expect.yaml', 'run:\n  status: succeeded\n');
      writeScenarioFile(root, 'hello', 'workflow.yml', 'jobs:\n  build:\n    steps: []\n');

      const scenarios = discoverScenarios(root);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]).toMatchObject({
        name: 'hello',
        configPath: '.shipfox/workflows/hello.yml',
        workflowYaml: 'jobs:\n  build:\n    steps: []\n',
      });
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('reports the scenario name when workflow.yml is missing', () => {
    const root = createTempScenariosRoot();
    try {
      writeScenarioFile(root, 'missing-workflow', 'expect.yaml', 'run:\n  status: succeeded\n');

      const act = () => discoverScenarios(root);

      expect(act).toThrow('Scenario "missing-workflow" is missing workflow.yml');
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
