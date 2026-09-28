import {describe, expect, it} from '@shipfox/vitest/vi';
import {computeTemplateBump, type TemplateBump} from './bump.js';
import {workflowTemplateManifestSchema} from './manifest.js';

type ManifestFields = Record<string, unknown>;

function manifest(fields: ManifestFields = {}) {
  return workflowTemplateManifestSchema.parse({
    title: 'Task to pull request',
    summary: 'Turn a task into a tested pull request.',
    starts: 'A task arrives from your coding agent or a tracker',
    roles: {
      source: {from: 'project', providers: ['github']},
      tracker: {
        providers: ['linear', 'jira'],
        optional: true,
        question: 'Should the workflow read tasks from a tracker?',
        tradeoff: 'The tracker adds a trigger and a write-back.',
      },
    },
    options: [
      {
        id: 'feedback_loop',
        choices: [{id: 'on', default: true}, {id: 'off'}],
      },
    ],
    slots: [{id: 'test_command', description: 'The command that runs the tests.'}],
    writes: [{provider: 'github', action: 'Opens a pull request.'}],
    ...fields,
  });
}

interface BumpCase {
  rule: string;
  previous?: ManifestFields;
  next: ManifestFields;
  bump: TemplateBump;
}

describe('computeTemplateBump', () => {
  it.each<BumpCase>([
    {
      rule: 'a required role is added',
      next: {
        roles: {
          source: {from: 'project', providers: ['github']},
          tracker: {providers: ['linear'], optional: true, question: 'Q?', tradeoff: 'T.'},
          deploy: {providers: ['github']},
        },
      },
      bump: 'major',
    },
    {
      rule: 'a required role is removed',
      next: {
        roles: {tracker: {providers: ['linear'], optional: true, question: 'Q?', tradeoff: 'T.'}},
        writes: [],
      },
      bump: 'major',
    },
    {
      rule: 'an optional role is removed',
      next: {roles: {source: {from: 'project', providers: ['github']}}},
      bump: 'major',
    },
    {
      rule: 'a provider is removed from a role',
      next: {
        roles: {
          source: {from: 'project', providers: ['github']},
          tracker: {providers: ['linear'], optional: true, question: 'Q?', tradeoff: 'T.'},
        },
      },
      bump: 'major',
    },
    {
      rule: 'an optional role becomes required',
      next: {
        roles: {
          source: {from: 'project', providers: ['github']},
          tracker: {providers: ['linear', 'jira']},
        },
      },
      bump: 'major',
    },
    {
      rule: 'an option is removed',
      next: {options: []},
      bump: 'major',
    },
    {
      rule: 'a choice is removed',
      next: {options: [{id: 'feedback_loop', choices: [{id: 'on', default: true}]}]},
      bump: 'major',
    },
    {
      rule: 'a slot is added',
      next: {
        slots: [
          {id: 'test_command', description: 'The command that runs the tests.'},
          {id: 'base_branch', description: 'The branch pull requests target.'},
        ],
      },
      bump: 'major',
    },
    {
      rule: 'a secret is added',
      next: {secrets: [{name: 'REGISTRY_TOKEN', description: 'Reads the private registry.'}]},
      bump: 'major',
    },
    {
      rule: 'a variable is added',
      next: {variables: [{name: 'REGISTRY_URL', description: 'The private registry URL.'}]},
      bump: 'major',
    },
    {
      rule: 'an optional role is added',
      next: {
        roles: {
          source: {from: 'project', providers: ['github']},
          tracker: {
            providers: ['linear', 'jira'],
            optional: true,
            question: 'Should the workflow read tasks from a tracker?',
            tradeoff: 'The tracker adds a trigger and a write-back.',
          },
          report: {providers: ['slack'], optional: true, question: 'Q?', tradeoff: 'T.'},
        },
      },
      bump: 'minor',
    },
    {
      rule: 'a provider is added to a role',
      next: {
        roles: {
          source: {from: 'project', providers: ['github', 'gitea']},
          tracker: {
            providers: ['linear', 'jira'],
            optional: true,
            question: 'Should the workflow read tasks from a tracker?',
            tradeoff: 'The tracker adds a trigger and a write-back.',
          },
        },
      },
      bump: 'minor',
    },
    {
      rule: 'an option is added',
      next: {
        options: [
          {id: 'feedback_loop', choices: [{id: 'on', default: true}, {id: 'off'}]},
          {id: 'pr_mode', choices: [{id: 'draft', default: true}, {id: 'ready'}]},
        ],
      },
      bump: 'minor',
    },
    {
      rule: 'a choice is added',
      next: {
        options: [
          {id: 'feedback_loop', choices: [{id: 'on', default: true}, {id: 'off'}, {id: 'once'}]},
        ],
      },
      bump: 'minor',
    },
    {
      rule: 'a writes entry is added',
      next: {
        writes: [
          {provider: 'github', action: 'Opens a pull request.'},
          {provider: 'github', action: 'Replies to review threads.'},
        ],
      },
      bump: 'minor',
    },
    {
      rule: 'the title, summary, keywords, starts, and flow change',
      next: {
        title: 'Task to PR',
        summary: 'Turn a task into a tested PR.',
        keywords: ['pull-request'],
        starts: 'A task arrives',
        flow: [{kind: 'agent', title: 'The agent works', detail: 'It makes a change.'}],
      },
      bump: 'patch',
    },
    {
      rule: 'a required role becomes optional',
      previous: {roles: {source: {providers: ['github']}}},
      next: {
        roles: {source: {providers: ['github'], optional: true, question: 'Q?', tradeoff: 'T.'}},
      },
      bump: 'patch',
    },
    {
      rule: 'a slot, secret, variable, or writes entry is removed or reworded',
      previous: {
        secrets: [{name: 'REGISTRY_TOKEN', description: 'Reads the private registry.'}],
        variables: [{name: 'REGISTRY_URL', description: 'The private registry URL.'}],
      },
      next: {
        slots: [{id: 'test_command', description: 'Runs the tests.'}],
        secrets: [],
        variables: [],
        writes: [],
      },
      bump: 'patch',
    },
    {
      rule: 'a default choice, question, or tradeoff changes',
      next: {
        options: [
          {
            id: 'feedback_loop',
            question: 'Should the workflow answer review comments?',
            choices: [{id: 'on'}, {id: 'off', default: true, tradeoff: 'Reviews stay manual.'}],
          },
        ],
      },
      bump: 'patch',
    },
    {
      rule: 'a change needs more than one bump',
      next: {
        roles: {
          source: {from: 'project', providers: ['github', 'gitea']},
          tracker: {
            providers: ['linear', 'jira'],
            optional: true,
            question: 'Should the workflow read tasks from a tracker?',
            tradeoff: 'The tracker adds a trigger and a write-back.',
          },
        },
        variables: [{name: 'REGISTRY_URL', description: 'The private registry URL.'}],
      },
      bump: 'major',
    },
  ])('returns $bump when $rule', ({previous, next, bump}) => {
    const result = computeTemplateBump({previous: manifest(previous), next: manifest(next)});

    expect(result).toBe(bump);
  });

  it('returns patch for identical manifests', () => {
    const result = computeTemplateBump({previous: manifest(), next: manifest()});

    expect(result).toBe('patch');
  });

  it('treats a role id that matches an object prototype key as an added role', () => {
    const previous = manifest();
    const next = manifest({
      roles: {
        ...previous.roles,
        constructor: {providers: ['slack'], optional: true, question: 'Q?', tradeoff: 'T.'},
      },
    });

    const result = computeTemplateBump({previous, next});

    expect(result).toBe('minor');
  });
});
