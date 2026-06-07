import {parseYamlSurfaceWorkflowDocument} from './parse-yaml-surface-workflow-document.js';
import {validateSurfaceWorkflowDocument} from './surface-workflow-document.js';
import {surfaceWorkflowDocumentCueSchema} from './surface-workflow-document-cue.js';

describe('parseYamlSurfaceWorkflowDocument', () => {
  test('parses a valid YAML surface workflow document', () => {
    const yaml = `
name: Test
triggers:
  on_demand:
    source: manual
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = parseYamlSurfaceWorkflowDocument(yaml);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.document.name).toBe('Test');
      expect(result.document.triggers?.on_demand?.event).toBe('fire');
      expect(result.document.jobs.build?.steps).toHaveLength(1);
    }
  });

  test('returns a YAML syntax error for invalid YAML', () => {
    const result = parseYamlSurfaceWorkflowDocument('name: Bad\n  invalid:\nindentation');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.message).toContain('Invalid YAML syntax');
    }
  });

  test('rejects YAML values that do not parse to an object', () => {
    const result = parseYamlSurfaceWorkflowDocument('just a string');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.message).toBe('Workflow definition must be a YAML object');
    }
  });
});

describe('validateSurfaceWorkflowDocument', () => {
  test('rejects an empty workflow name', () => {
    const result = validateSurfaceWorkflowDocument({
      name: '',
      jobs: {build: {steps: [{run: 'echo hello'}]}},
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.path).toBe('name');
    }
  });

  test('preserves string list unions and trigger passthrough fields', () => {
    const result = validateSurfaceWorkflowDocument({
      name: 'Test',
      runner: ['linux', 'docker'],
      triggers: {
        on_push: {
          source: 'github',
          event: 'push',
          on: ['main', 'release'],
          with: {repository: 'shipfox/platform'},
          filter: 'changed("apps/**")',
        },
      },
      jobs: {
        build: {
          needs: 'prepare',
          runner: 'linux',
          steps: [{run: 'echo hello', name: 'Say hello'}],
        },
      },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.document.runner).toEqual(['linux', 'docker']);
      expect(result.document.triggers?.on_push?.on).toEqual(['main', 'release']);
      expect(result.document.triggers?.on_push?.with).toEqual({
        repository: 'shipfox/platform',
      });
      expect(result.document.triggers?.on_push?.filter).toBe('changed("apps/**")');
      expect(result.document.jobs.build?.needs).toBe('prepare');
      expect(result.document.jobs.build?.runner).toBe('linux');
    }
  });

  test('rejects a non-manual trigger without an event', () => {
    const result = validateSurfaceWorkflowDocument({
      name: 'Test',
      triggers: {on_push: {source: 'github'}},
      jobs: {build: {steps: [{run: 'echo hello'}]}},
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.message).toBe("event is required for source 'github'");
      expect(result.errors[0]?.path).toBe('triggers.on_push.event');
    }
  });

  test('rejects multiple manual triggers', () => {
    const result = validateSurfaceWorkflowDocument({
      name: 'Test',
      triggers: {
        deploy: {source: 'manual'},
        rollback: {source: 'manual'},
      },
      jobs: {run: {steps: [{run: 'echo hello'}]}},
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.message).toContain('at most one manual trigger');
      expect(result.errors[0]?.path).toBe('triggers');
    }
  });
});

describe('surfaceWorkflowDocumentCueSchema', () => {
  test('documents CUE as a formalization artifact, not an authoring surface', () => {
    expect(surfaceWorkflowDocumentCueSchema).toContain('#SurfaceWorkflowDocument');
    expect(surfaceWorkflowDocumentCueSchema).toContain('not an accepted authoring input');
  });
});
