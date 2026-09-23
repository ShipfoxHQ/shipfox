import {describe, expect, it} from '@shipfox/vitest/vi';
import {workflowTemplateManifestSchema, workflowTemplateOptionSchema} from './manifest.js';

describe('workflowTemplateOptionSchema', () => {
  it('rejects duplicate choice ids', () => {
    const result = workflowTemplateOptionSchema.safeParse({
      id: 'mode',
      choices: [{id: 'fast'}, {id: 'fast'}],
    });

    expect(result.success).toBe(false);
  });

  it('rejects multiple default choices', () => {
    const result = workflowTemplateOptionSchema.safeParse({
      id: 'mode',
      choices: [
        {id: 'fast', default: true},
        {id: 'safe', default: true},
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe('workflowTemplateManifestSchema', () => {
  it('accepts project-bound roles and declared option metadata', () => {
    const manifest = workflowTemplateManifestSchema.parse({
      id: 'fixture',
      revision: 1,
      added_at: '2026-10-01',
      title: 'Fixture',
      summary: 'A fixture template.',
      roles: {source: {from: 'project', providers: ['github']}},
      options: [
        {
          id: 'mode',
          question: 'Which mode should run?',
          choices: [{id: 'fast', default: true, tradeoff: 'Uses fewer checks.'}],
          applies_to: ['source'],
        },
      ],
      models: {
        fix: {
          reference: {model: 'claude-sonnet-5', thinking: 'high'},
          note: 'Repairs the failed check.',
        },
        review: {},
      },
      slots: ['setup_commands'],
      secrets: ['TOKEN'],
      variables: ['COMMAND'],
    });

    const sourceRole = manifest.roles.source;
    if (sourceRole === undefined) throw new Error('Source role was not parsed');

    expect(sourceRole.from).toBe('project');
    expect(manifest.options[0]?.choices[0]?.default).toBe(true);
    expect(manifest.models.fix?.reference).toEqual({model: 'claude-sonnet-5', thinking: 'high'});
    expect(manifest.models.review).toEqual({});
  });

  it('rejects invalid model placeholder names and thinking levels', () => {
    const base = {
      id: 'fixture',
      revision: 1,
      added_at: '2026-10-01',
      title: 'Fixture',
      summary: 'A fixture template.',
      roles: {source: {providers: ['github']}},
    };

    expect(
      workflowTemplateManifestSchema.safeParse({...base, models: {'Bad Key': {}}}).success,
    ).toBe(false);
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...base,
        models: {fix: {reference: {model: 'claude-sonnet-5', thinking: 'turbo'}}},
      }).success,
    ).toBe(false);
  });
});
