import type {WorkflowDefinition} from '#core/entities/workflow-definition.js';
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {toDefinitionDto} from './definition.js';

describe('toDefinitionDto', () => {
  it('maps the workflow definition entity to the public DTO shape', () => {
    const document = {
      name: 'Manual workflow',
      triggers: {
        run_now: {
          source: 'manual',
          event: 'fire',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
      },
    };
    const definition: WorkflowDefinition = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991381',
      configPath: '.shipfox/workflows/manual.yml',
      source: 'manual',
      sha: null,
      ref: null,
      name: document.name,
      definition: document,
      sourceYaml: 'name: Manual workflow\n',
      document,
      model: normalizeWorkflowDocument(document),
      contentHash: null,
      fetchedAt: new Date('2026-06-09T10:00:00.000Z'),
      createdAt: new Date('2026-06-09T10:00:01.000Z'),
      updatedAt: new Date('2026-06-09T10:00:02.000Z'),
      deletedAt: null,
    };

    const result = toDefinitionDto(definition);

    expect(result).toEqual({
      id: definition.id,
      project_id: definition.projectId,
      config_path: definition.configPath,
      source: 'manual',
      sha: null,
      ref: null,
      name: document.name,
      workflow_source_yaml: definition.sourceYaml,
      workflow_document: document,
      workflow_model: definition.model,
      manual_trigger: {name: 'run_now'},
      fetched_at: '2026-06-09T10:00:00.000Z',
      created_at: '2026-06-09T10:00:01.000Z',
      updated_at: '2026-06-09T10:00:02.000Z',
    });
  });

  it('maps missing source YAML to null', () => {
    const document = {
      name: 'Legacy workflow',
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
      },
    };
    const definition: WorkflowDefinition = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991381',
      configPath: '.shipfox/workflows/legacy.yml',
      source: 'vcs',
      sha: null,
      ref: 'main',
      name: document.name,
      definition: document,
      sourceYaml: null,
      document,
      model: normalizeWorkflowDocument(document),
      contentHash: null,
      fetchedAt: new Date('2026-06-09T10:00:00.000Z'),
      createdAt: new Date('2026-06-09T10:00:01.000Z'),
      updatedAt: new Date('2026-06-09T10:00:02.000Z'),
      deletedAt: null,
    };

    const result = toDefinitionDto(definition);

    expect(result.workflow_source_yaml).toBeNull();
  });
});
