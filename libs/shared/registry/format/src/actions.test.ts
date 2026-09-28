import {type ActionManifestInput, actionManifestSchema} from '@shipfox/workflow-document';
import {computeActionBump, deriveActionMetadata, diffActionCapabilities} from '#actions.js';
import {type RegistryBump, registryActionVersionDocumentSchema} from '#documents.js';
import {actionVersionDocument} from '#test/fixtures/documents.js';

function manifest(fields: Partial<ActionManifestInput> = {}) {
  return actionManifestSchema.parse({
    name: 'Slack thread digest',
    main: 'index.mjs',
    inputs: {thread: {type: 'string', required: true}, limit: {type: 'number'}},
    outputs: {markdown: {type: 'string'}},
    integrations: {slack: {provider: 'slack', include: ['conversations.replies']}},
    ...fields,
  });
}

interface BumpCase {
  rule: string;
  previous?: Partial<ActionManifestInput>;
  next: Partial<ActionManifestInput>;
  bump: RegistryBump;
}

describe('computeActionBump', () => {
  it.each<BumpCase>([
    {
      rule: 'an input is removed',
      next: {inputs: {thread: {type: 'string', required: true}}},
      bump: 'major',
    },
    {
      rule: 'an input type changes',
      next: {inputs: {thread: {type: 'string', required: true}, limit: {type: 'string'}}},
      bump: 'major',
    },
    {
      rule: 'an optional input becomes required without a default',
      next: {
        inputs: {thread: {type: 'string', required: true}, limit: {type: 'number', required: true}},
      },
      bump: 'major',
    },
    {
      rule: 'an input loses the default that made it optional',
      previous: {inputs: {thread: {type: 'string', required: true, default: 'latest'}}},
      next: {inputs: {thread: {type: 'string', required: true}}},
      bump: 'major',
    },
    {
      rule: 'a required input without a default is added',
      next: {
        inputs: {
          thread: {type: 'string', required: true},
          limit: {type: 'number'},
          channel: {type: 'string', required: true},
        },
      },
      bump: 'major',
    },
    {
      rule: 'an output is removed',
      next: {outputs: {}},
      bump: 'major',
    },
    {
      rule: 'an output type changes',
      next: {outputs: {markdown: {type: 'json'}}},
      bump: 'major',
    },
    {
      rule: 'an integration alias is added',
      next: {
        integrations: {
          slack: {provider: 'slack', include: ['conversations.replies']},
          tracker: {provider: 'linear', include: ['issues']},
        },
      },
      bump: 'major',
    },
    {
      rule: 'an integration alias is removed',
      next: {integrations: {}},
      bump: 'major',
    },
    {
      rule: 'an alias provider changes',
      next: {integrations: {slack: {provider: 'discord', include: ['conversations.replies']}}},
      bump: 'major',
    },
    {
      rule: '`allow_write` turns on',
      next: {
        integrations: {
          slack: {provider: 'slack', include: ['conversations.replies'], allow_write: true},
        },
      },
      bump: 'major',
    },
    {
      rule: 'an optional input is added',
      next: {
        inputs: {
          thread: {type: 'string', required: true},
          limit: {type: 'number'},
          include_reactions: {type: 'boolean'},
        },
      },
      bump: 'minor',
    },
    {
      rule: 'a required input with a default is added',
      next: {
        inputs: {
          thread: {type: 'string', required: true},
          limit: {type: 'number'},
          format: {type: 'string', required: true, default: 'markdown'},
        },
      },
      bump: 'minor',
    },
    {
      rule: 'an output is added',
      next: {outputs: {markdown: {type: 'string'}, participants: {type: 'number'}}},
      bump: 'minor',
    },
    {
      rule: 'selectors are added',
      next: {
        integrations: {slack: {provider: 'slack', include: ['conversations.replies', 'users']}},
      },
      bump: 'minor',
    },
    {
      rule: 'selectors are removed',
      previous: {
        integrations: {slack: {provider: 'slack', include: ['conversations.replies', 'users']}},
      },
      next: {},
      bump: 'patch',
    },
    {
      rule: '`allow_write` turns off',
      previous: {
        integrations: {
          slack: {provider: 'slack', include: ['conversations.replies'], allow_write: true},
        },
      },
      next: {},
      bump: 'patch',
    },
    {
      rule: 'a required input gains a default',
      next: {
        inputs: {
          thread: {type: 'string', required: true, default: 'latest'},
          limit: {type: 'number'},
        },
      },
      bump: 'patch',
    },
    {
      rule: 'only descriptions change',
      next: {description: 'Summarizes a Slack thread.'},
      bump: 'patch',
    },
  ])('is $bump when $rule', ({previous = {}, next, bump}) => {
    const result = computeActionBump({previous: manifest(previous), next: manifest(next)});

    expect(result).toBe(bump);
  });

  it('keeps the highest bump across rules', () => {
    const next = manifest({
      outputs: {markdown: {type: 'string'}, participants: {type: 'number'}},
      integrations: {
        slack: {provider: 'slack', include: ['conversations.replies'], allow_write: true},
      },
    });

    const result = computeActionBump({previous: manifest(), next});

    expect(result).toBe('major');
  });

  it('treats a manifest name that matches an object prototype key as absent', () => {
    const previous = manifest({inputs: {}});
    const next = manifest({inputs: {constructor: {type: 'string' as const, required: true}}});

    const result = computeActionBump({previous, next});

    expect(result).toBe('major');
  });
});

describe('diffActionCapabilities', () => {
  it('reports each capability change of an alias', () => {
    const previous = manifest({
      integrations: {
        slack: {provider: 'slack', include: ['conversations.replies', 'users'], allow_write: true},
        tracker: {provider: 'linear', include: ['issues']},
        chat: {provider: 'slack', include: ['chat']},
      },
    });
    const next = manifest({
      integrations: {
        slack: {provider: 'slack', include: ['conversations.replies', 'reactions']},
        tracker: {provider: 'jira', include: ['issues']},
        repo: {provider: 'github', include: ['pulls']},
      },
    });

    const result = diffActionCapabilities({previous, next});

    expect(result).toEqual([
      {type: 'alias_removed', alias: 'chat', provider: 'slack'},
      {type: 'write_disabled', alias: 'slack'},
      {type: 'selectors_added', alias: 'slack', selectors: ['reactions']},
      {type: 'selectors_removed', alias: 'slack', selectors: ['users']},
      {type: 'provider_changed', alias: 'tracker', from: 'linear', to: 'jira'},
      {type: 'alias_added', alias: 'repo', provider: 'github'},
    ]);
  });

  it('reports nothing when the integrations are unchanged', () => {
    const result = diffActionCapabilities({previous: manifest(), next: manifest()});

    expect(result).toEqual([]);
  });
});

describe('deriveActionMetadata', () => {
  const reference = {namespace: 'shipfox', name: 'slack-thread-digest', version: '1.4.2'};

  it('derives integrations, capabilities, interface, usage, and size', () => {
    const source = manifest({
      inputs: {
        thread: {type: 'string', required: true, description: 'Thread URL.'},
        limit: {type: 'number', default: 50},
        format: {type: 'string', required: true, default: 'markdown'},
      },
      integrations: {
        slack: {provider: 'slack', include: ['conversations.replies']},
        tracker: {provider: 'linear', include: ['issues'], allow_write: true},
        chat: {provider: 'slack', include: ['chat']},
      },
    });

    const result = deriveActionMetadata({reference, manifest: source, contentBytes: 48213});

    expect(result).toEqual({
      integrations: ['linear', 'slack'],
      capabilities: {
        slack: {provider: 'slack', selectors: ['conversations.replies'], allow_write: false},
        tracker: {provider: 'linear', selectors: ['issues'], allow_write: true},
        chat: {provider: 'slack', selectors: ['chat'], allow_write: false},
      },
      interface: {
        inputs: {
          thread: {type: 'string', required: true, description: 'Thread URL.'},
          limit: {type: 'number', required: false, default: 50},
          format: {type: 'string', required: true, default: 'markdown'},
        },
        outputs: {markdown: {type: 'string', required: false}},
      },
      usage: [
        'uses: shipfox/slack-thread-digest@1.4.2',
        'with:',
        '  thread: <string>',
        'connections:',
        '  slack: <slack connection>',
        '  tracker: <linear connection>',
        '  chat: <slack connection>',
        '',
      ].join('\n'),
      size: 48213,
    });
  });

  it('writes only `uses:` for an action without required inputs or integrations', () => {
    const source = manifest({inputs: {limit: {type: 'number'}}, integrations: undefined});

    const result = deriveActionMetadata({reference, manifest: source, contentBytes: 1});

    expect(result.usage).toBe('uses: shipfox/slack-thread-digest@1.4.2\n');
  });

  it('produces metadata that the version document accepts', () => {
    const derived = deriveActionMetadata({reference, manifest: manifest(), contentBytes: 48213});

    const result = registryActionVersionDocumentSchema.safeParse({
      ...actionVersionDocument(),
      derived,
    });

    expect(result.success).toBe(true);
  });
});
