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
  it('rejects duplicate option ids', () => {
    const result = workflowTemplateManifestSchema.safeParse({
      ...baseManifest,
      options: [
        {id: 'mode', choices: [{id: 'fast'}]},
        {id: 'mode', choices: [{id: 'safe'}]},
      ],
    });

    expect(result.success).toBe(false);
  });

  it('accepts manifest v2 metadata and described fields', () => {
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
        {action: 'With a tracker, comments on the ticket.'},
      ],
      prerequisites: ['With Slack, invite the app to the report channel.'],
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

    expect(manifest.writes[1]).toEqual({action: 'With a tracker, comments on the ticket.'});
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
    const legacyValues = {
      id: 'fixture',
      revision: 1,
      added_at: '2026-10-01',
      rank: 1,
      start_label: 'Starts on a task',
    };

    for (const [field, value] of Object.entries(legacyValues)) {
      expect(
        workflowTemplateManifestSchema.safeParse({...baseManifest, [field]: value}).success,
      ).toBe(false);
    }
  });

  it('requires related packages to use registry package-name rules', () => {
    for (const related of ['a/pkg', 'shipfox/a', 'shipfox/-invalid', `shipfox/${'a'.repeat(41)}`]) {
      expect(
        workflowTemplateManifestSchema.safeParse({...baseManifest, related: [related]}).success,
      ).toBe(false);
    }
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        related: ['shipfox/slack-thread-digest'],
      }).success,
    ).toBe(true);
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

  it('rejects conditions on writes and prerequisites', () => {
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        writes: [{provider: 'github', action: 'Opens a pull request.', when: {role: 'source'}}],
      }).success,
    ).toBe(false);
    expect(
      workflowTemplateManifestSchema.safeParse({
        ...baseManifest,
        prerequisites: [{text: 'Invite the app.', when: {role: 'source'}}],
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
