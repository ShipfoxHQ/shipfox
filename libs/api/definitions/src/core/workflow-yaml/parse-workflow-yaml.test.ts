import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {InvalidWorkflowDocumentError} from '@shipfox/workflow-document';
import {InvalidWorkflowYamlError} from './invalid-workflow-yaml-error.js';
import {parseWorkflowYaml} from './parse-workflow-yaml.js';

async function readFixture(path: string): Promise<string> {
  const fixtureUrl = import.meta.resolve(`#test/fixtures/workflow-yaml/${path}`);
  return await readFile(fileURLToPath(fixtureUrl), 'utf8');
}

describe('parseWorkflowYaml', () => {
  it('parses valid workflow YAML into a workflow document', async () => {
    const source = await readFixture('valid/simple-build.yaml');
    const expected = JSON.parse(await readFixture('valid/simple-build.document.json')) as unknown;

    const document = parseWorkflowYaml(source);

    expect(document).toEqual(expected);
  });

  it('throws a typed YAML error for YAML syntax errors', async () => {
    const source = await readFixture('invalid/invalid-yaml-syntax.yaml');

    try {
      parseWorkflowYaml(source);
      expect.fail('Expected InvalidWorkflowYamlError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowYamlError);
      expect(error).toMatchObject({
        code: 'invalid-workflow-yaml',
        reason: 'syntax',
      });
      expect((error as InvalidWorkflowYamlError).location?.line).toBeGreaterThanOrEqual(1);
      expect((error as InvalidWorkflowYamlError).location?.column).toBeGreaterThanOrEqual(1);
      expect((error as Error).message).toContain('Invalid workflow YAML syntax:');
      expect((error as Error).cause).toBeDefined();
    }
  });

  it.each([
    ['array root', '- npm test'],
    ['scalar root', '42'],
    ['empty input', ''],
  ])('throws a typed YAML error for %s', (_name, source) => {
    try {
      parseWorkflowYaml(source);
      expect.fail('Expected InvalidWorkflowYamlError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowYamlError);
      expect(error).toMatchObject({
        code: 'invalid-workflow-yaml',
        reason: 'non-object-root',
      });
    }
  });

  it('delegates workflow document validation to the shared document package', async () => {
    const source = await readFixture('invalid/missing-step-run.yaml');

    try {
      parseWorkflowYaml(source);
      expect.fail('Expected InvalidWorkflowDocumentError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowDocumentError);
      expect((error as InvalidWorkflowDocumentError).validationError.issues[0]).toMatchObject({
        path: ['jobs', 'build', 'steps', 0, 'run'],
      });
    }
  });
});
