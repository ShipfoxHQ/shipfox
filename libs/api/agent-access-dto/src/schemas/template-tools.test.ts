import {Ajv} from 'ajv';
import * as addFormatsModule from 'ajv-formats';
import {
  getWorkflowTemplateResultJsonSchema,
  getWorkflowTemplateResultSchema,
} from './template-tools.js';

const addFormats = addFormatsModule.default as unknown as (validator: Ajv) => void;
const model = {model: 'claude-sonnet-5'};
const noModel = {model: null, reason: 'no-compatible-model'};
const resolvedModels = {
  balanced: {mechanical: model, implementation: model, review: noModel},
  economy: {mechanical: model, implementation: model, review: model},
  strongest: {mechanical: model, implementation: noModel, review: model},
};
const result = {
  template_id: 'ticket-to-pr',
  revision: 1,
  options: [],
  workflow_yaml: 'name: workflow',
  guide_markdown: '# Guide',
  suggested_bindings: {source: ['github-main']},
  resolved_models: resolvedModels,
};

describe('workflow template result schemas', () => {
  test('accept resolved models and keep the JSON schema aligned', () => {
    expect(getWorkflowTemplateResultSchema.safeParse(result).success).toBe(true);
    expect(getWorkflowTemplateResultJsonSchema.required).toContain('resolved_models');

    const ajv = new Ajv({strict: true, strictRequired: false});
    addFormats(ajv);
    expect(ajv.compile(getWorkflowTemplateResultJsonSchema)(result)).toBe(true);
  });

  test('requires a reason when a model cannot be resolved', () => {
    const invalidResult = {
      ...result,
      resolved_models: {
        ...resolvedModels,
        balanced: {...resolvedModels.balanced, mechanical: {model: null}},
      },
    };
    const ajv = new Ajv({strict: true, strictRequired: false});
    addFormats(ajv);

    expect(getWorkflowTemplateResultSchema.safeParse(invalidResult).success).toBe(false);
    expect(ajv.compile(getWorkflowTemplateResultJsonSchema)(invalidResult)).toBe(false);
  });

  test('forbids a reason when a model is resolved', () => {
    const invalidResult = {
      ...result,
      resolved_models: {
        ...resolvedModels,
        balanced: {
          ...resolvedModels.balanced,
          mechanical: {model: 'claude-sonnet-5', reason: 'no-compatible-model'},
        },
      },
    };
    const ajv = new Ajv({strict: true, strictRequired: false});
    addFormats(ajv);

    expect(getWorkflowTemplateResultSchema.safeParse(invalidResult).success).toBe(false);
    expect(ajv.compile(getWorkflowTemplateResultJsonSchema)(invalidResult)).toBe(false);
  });
});
