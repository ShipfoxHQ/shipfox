import {describe, expect, it} from '@shipfox/vitest/vi';
import {workflowTemplateManifestSchema, workflowTemplateOptionSchema} from './manifest.js';

const baseManifest = {
  title: 'Fixture',
  summary: 'A fixture template.',
  starts: 'A task arrives from a tracker',
  roles: {source: {from: 'project', providers: ['github']}},
};

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
  it('accepts manifest v2 metadata, conditions, and described fields', () => {
    const manifest = workflowTemplateManifestSchema.parse({
      ...baseManifest,
      keywords: ['coding-agent', 'pull-request'],
      flow: [
        {
          kind: 'trigger',
          provider: 'github',
          title: 'A task arrives',
          detail: 'The issue is ready.',
        },
        {kind: 'agent', title: 'The agent works', detail: 'It makes a change.'},
        {kind: 'check', title: 'The workflow checks', detail: 'The checks run.', loops_to: 1},
      ],
      writes: [
        {provider: 'github', action: 'Opens a pull request.'},
        {
          provider: 'github',
          action: 'Adds a review label.',
          when: {option: 'feedback', choices: ['on']},
        },
      ],
      prerequisites: [
        'Run CI on GitHub Actions.',
        {text: 'Invite the app to Slack.', when: {role: 'report', provider: 'slack'}},
      ],
      related: ['shipfox/fix-default-branch-ci'],
      roles: {
        ...baseManifest.roles,
        report: {
          providers: ['slack'],
          optional: true,
          question: 'Should the workflow report to Slack?',
          tradeoff: 'Posts one message for each run.',
        },
      },
      options: [
        {
          id: 'feedback',
          choices: [{id: 'off'}, {id: 'on', default: true}],
        },
      ],
      models: {
        fix: {note: 'Repairs the failed check.'},
        review: {},
      },
      slots: [{id: 'setup_commands', description: 'Commands to prepare the repository.'}],
      secrets: [{name: 'TOKEN', description: 'Token used by the tracker integration.'}],
      variables: [{name: 'COMMAND', description: 'Command the workflow runs.'}],
    });

    expect(manifest.roles.source?.from).toBe('project');
    expect(manifest.options[0]?.choices[1]?.default).toBe(true);
    expect(manifest.models.fix).toEqual({note: 'Repairs the failed check.'});
    expect(manifest.slots[0]).toEqual({
      id: 'setup_commands',
      description: 'Commands to prepare the repository.',
    });
    expect(manifest.secrets[0]?.name).toBe('TOKEN');
    expect(manifest.variables[0]?.name).toBe('COMMAND');
  });

  it('rejects all transitional identity and start-label fields', () => {
    for (const field of ['id', 'revision', 'added_at', 'rank', 'start_label']) {
      expect(
        workflowTemplateManifestSchema.safeParse({...baseManifest, [field]: 'legacy'}).success,
      ).toBe(false);
    }
  });

  it('requires a start phrase and limits it to 120 characters', () => {
    const {starts: _starts, ...withoutStarts} = baseManifest;

    expect(workflowTemplateManifestSchema.safeParse(withoutStarts).success).toBe(false);
    expect(
      workflowTemplateManifestSchema.safeParse({...baseManifest, starts: 'a'.repeat(121)}).success,
    ).toBe(false);
  });

  it('limits keywords to ten unique slugs', () => {
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        keywords: Array.from({length: 11}, (_, index) => `keyword-${index}`),
      }).success,
    ).toBe(false);
    expect(
      workflowTemplateManifestSchema.safeParse({...baseManifest, keywords: ['same', 'same']})
        .success,
    ).toBe(false);
  });

  it('requires flow loops to point to an earlier step', () => {
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        flow: [{kind: 'check', title: 'Check', detail: 'Run checks.', loops_to: 0}],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: 'a missing role',
      when: {role: 'missing'},
    },
    {
      name: 'a provider not declared by the role',
      when: {role: 'source', provider: 'linear'},
    },
    {
      name: 'a missing option',
      when: {option: 'missing', choices: ['on']},
    },
    {
      name: 'a choice not declared by the option',
      when: {option: 'feedback', choices: ['missing']},
    },
  ])('rejects when conditions with $name', ({when}) => {
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        roles: {
          source: baseManifest.roles.source,
          report: {
            providers: ['slack'],
            optional: true,
            question: 'Should this report?',
            tradeoff: 'Adds a report.',
          },
        },
        options: [{id: 'feedback', choices: [{id: 'on'}]}],
        writes: [{provider: 'github', action: 'Opens a pull request.', when}],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown providers in flow and writes', () => {
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        flow: [{kind: 'write', provider: 'linear', title: 'Posts', detail: 'Posts an issue.'}],
      }).success,
    ).toBe(false);
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        writes: [{provider: 'linear', action: 'Creates an issue.'}],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: 'an optional role without a question',
      role: {providers: ['slack'], optional: true, tradeoff: 'Posts to Slack.'},
    },
    {
      name: 'an optional role without a tradeoff',
      role: {providers: ['slack'], optional: true, question: 'Report to Slack?'},
    },
    {
      name: 'an optional project role',
      role: {
        from: 'project',
        providers: ['github'],
        optional: true,
        question: 'Use GitHub?',
        tradeoff: 'Reads the repository.',
      },
    },
    {
      name: 'a question on a required role',
      role: {providers: ['slack'], question: 'Report to Slack?'},
    },
  ])('rejects $name', ({role}) => {
    expect(
      workflowTemplateManifestSchema.safeParse({
        title: 'Fixture',
        summary: 'A fixture template.',
        starts: 'An event starts this workflow',
        roles: {role},
      }).success,
    ).toBe(false);
  });
});
