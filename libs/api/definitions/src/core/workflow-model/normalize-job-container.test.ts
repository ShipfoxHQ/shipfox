import type {WorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {
  InvalidWorkflowModelError,
  type WorkflowModelValidationIssue,
} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function normalizeContainer(container: WorkflowDocument['jobs'][string]['container']) {
  const diagnostics: WorkflowModelValidationIssue[] = [];
  const model = normalizeWorkflowDocument(
    {
      name: 'Container workflow',
      runner: 'ubuntu-latest',
      jobs: {build: {container, steps: [{run: 'echo ok'}]}},
    },
    {agentValidationCatalog, diagnostics},
  );
  return {container: model.jobs[0]?.container, diagnostics};
}

function containerIssues(container: Parameters<typeof normalizeContainer>[0]) {
  try {
    normalizeContainer(container);
  } catch (error) {
    if (error instanceof InvalidWorkflowModelError) return error.issues;
    throw error;
  }
  return expect.fail('Expected InvalidWorkflowModelError');
}

describe('normalizeJobContainer', () => {
  it('leaves jobs without a container untouched', () => {
    const {container, diagnostics} = normalizeContainer(undefined);

    expect(container).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('normalizes the image shorthand with the Docker socket on', () => {
    const {container, diagnostics} = normalizeContainer('node:24-bookworm');

    expect(container).toEqual({image: 'node:24-bookworm', dockerSocket: true});
    expect(diagnostics).toEqual([]);
  });

  it('normalizes literal object fields without templates', () => {
    const {container, diagnostics} = normalizeContainer({
      image: 'ghcr.io/acme/toolbox:2026.10',
      credentials: {username: 'acme-bot', password: 'not-a-template'},
      env: {LEVEL: 'debug', RETRIES: 3, VERBOSE: true},
      options: '--cpus 4 --memory 12g',
      docker_socket: false,
    });

    expect(container).toEqual({
      image: 'ghcr.io/acme/toolbox:2026.10',
      credentials: {username: 'acme-bot', password: 'not-a-template'},
      env: {LEVEL: 'debug', RETRIES: '3', VERBOSE: 'true'},
      options: '--cpus 4 --memory 12g',
      dockerSocket: false,
    });
    expect(diagnostics).toEqual([]);
  });

  it('keeps the authored text and records a template for each interpolated field', () => {
    const image = `ghcr.io/acme/${interpolation('vars.TOOLBOX')}`;
    const password = interpolation('secrets.REGISTRY_TOKEN');
    const license = interpolation('secrets.LICENSE');
    const options = `--memory ${interpolation('vars.MEMORY')}`;

    const {container, diagnostics} = normalizeContainer({
      image,
      credentials: {username: 'acme-bot', password},
      env: {LICENSE_KEY: license, STATIC: 'on'},
      options,
    });

    expect(diagnostics).toEqual([]);
    expect(container).toMatchObject({
      image,
      credentials: {username: 'acme-bot', password},
      env: {LICENSE_KEY: license, STATIC: 'on'},
      options,
      dockerSocket: true,
    });
    expect(container?.templates?.image).toEqual([
      {kind: 'literal', value: 'ghcr.io/acme/'},
      expect.objectContaining({kind: 'deferred', roots: ['vars']}),
    ]);
    expect(container?.templates?.options).toHaveLength(2);
    expect(container?.templates?.username).toBeUndefined();
    expect(container?.templates?.password).toHaveLength(1);
    expect(Object.keys(container?.templates?.env ?? {})).toEqual(['LICENSE_KEY']);
  });

  it.each([
    ['image', {image: interpolation('secrets.IMAGE')}, ['jobs', 'build', 'container', 'image']],
    [
      'options',
      {image: 'node', options: interpolation('secrets.FLAGS')},
      ['jobs', 'build', 'container', 'options'],
    ],
  ] as const)('rejects secrets in the %s', (_field, container, path) => {
    const issues = containerIssues(container);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(path);
  });

  it('rejects references to contexts that do not exist at execution creation', () => {
    const issues = containerIssues({image: interpolation('steps.build.outputs.image')});

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['jobs', 'build', 'container', 'image']);
  });

  it('reports malformed interpolation in credentials and env', () => {
    const issues = containerIssues({
      image: 'node',
      credentials: {username: '$'.concat('{{ vars.USER'), password: 'ok'},
      env: {BROKEN: '$'.concat('{{ vars.X')},
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      ['jobs', 'build', 'container', 'credentials', 'username'],
      ['jobs', 'build', 'container', 'env', 'BROKEN'],
    ]);
  });
});
