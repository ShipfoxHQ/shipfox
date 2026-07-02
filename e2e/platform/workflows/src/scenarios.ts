import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {type Expectation, parseExpectation} from './expect.js';

export interface ScenarioFile {
  path: string;
  content: string;
}

export interface Scenario {
  // Directory name; also the workflow file name pushed to .shipfox/workflows/<name>.yml.
  name: string;
  dir: string;
  configPath: string;
  workflowYaml: string;
  expectation: Expectation;
  // Everything under the scenario's files/ directory, committed verbatim alongside the
  // workflow so a scenario can assert on real repo contents from inside its steps.
  extraFiles: ScenarioFile[];
}

const scenariosRoot = fileURLToPath(new URL('../scenarios/', import.meta.url));

function readScenarioFiles(filesDir: string): ScenarioFile[] {
  if (!existsSync(filesDir)) return [];
  const files: ScenarioFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) {
        walk(absolute);
      } else {
        files.push({
          path: relative(filesDir, absolute).split('\\').join('/'),
          content: readFileSync(absolute, 'utf8'),
        });
      }
    }
  };
  walk(filesDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function loadScenario(name: string): Scenario {
  const dir = join(scenariosRoot, name);
  return {
    name,
    dir,
    configPath: `.shipfox/workflows/${name}.yml`,
    workflowYaml: readFileSync(join(dir, 'workflow.yml'), 'utf8'),
    expectation: parseExpectation(yaml.load(readFileSync(join(dir, 'expect.yaml'), 'utf8'))),
    extraFiles: readScenarioFiles(join(dir, 'files')),
  };
}

/**
 * Every directory under scenarios/ that carries an expect.yaml is a declarative
 * scenario the generic spec drives. Directories with a spec.e2e.ts instead are
 * ordinary Playwright specs (the escape hatch) and are skipped here.
 */
export function discoverScenarios(): Scenario[] {
  return readdirSync(scenariosRoot)
    .filter((name) => statSync(join(scenariosRoot, name)).isDirectory())
    .filter((name) => existsSync(join(scenariosRoot, name, 'expect.yaml')))
    .sort()
    .map(loadScenario);
}
