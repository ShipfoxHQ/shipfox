import {
  agentDocumentKeyForPath,
  buildAgentDocumentJsonSchema,
  InvalidAgentDocumentError,
  parseAgentDocument,
} from './agent-document.js';

describe('parseAgentDocument', () => {
  it('accepts an empty shippy document', () => {
    expect(parseAgentDocument({}, {key: 'shippy'})).toEqual({});
  });

  it('requires description and instructions for a custom agent', () => {
    expect(() => parseAgentDocument({name: 'Reviewer'}, {key: 'reviewer'})).toThrow(
      InvalidAgentDocumentError,
    );
    try {
      parseAgentDocument({name: 'Reviewer'}, {key: 'reviewer'});
    } catch (error) {
      const issues = (error as InvalidAgentDocumentError).validationError.issues;
      expect(issues.map((issue) => issue.path)).toEqual([['description'], ['instructions']]);
    }
  });

  it('accepts a custom agent with the reused step fields', () => {
    const document = parseAgentDocument(
      {
        name: 'Reviewer',
        description: 'Reviews pull requests.',
        instructions: ['Be brief.', {file: './.shipfox/prompts/review.md'}],
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        thinking: 'high',
        integrations: [{include: ['pull_request_read']}],
      },
      {key: 'reviewer'},
    );

    expect(document.instructions).toHaveLength(2);
    expect(document.integrations?.[0]?.include).toEqual(['pull_request_read']);
  });

  it('rejects harness, on, and unknown keys', () => {
    for (const extra of [{harness: 'pi'}, {on: []}, {key: 'x'}]) {
      expect(() =>
        parseAgentDocument({description: 'd', instructions: 'i', ...extra}, {key: 'reviewer'}),
      ).toThrow(InvalidAgentDocumentError);
    }
  });

  it('rejects an interpolated thinking level', () => {
    const thinking = '$'.concat('{{ inputs.level }}');
    expect(() => parseAgentDocument({thinking}, {key: 'shippy'})).toThrow(
      InvalidAgentDocumentError,
    );
  });
});

describe('agentDocumentKeyForPath', () => {
  it('takes the file name without its extension', () => {
    expect(agentDocumentKeyForPath('.shipfox/agents/shippy.yaml')).toBe('shippy');
    expect(agentDocumentKeyForPath('.shipfox/agents/code-reviewer.yml')).toBe('code-reviewer');
  });

  it('rejects nested files, other extensions, and invalid names', () => {
    expect(agentDocumentKeyForPath('.shipfox/agents/team/reviewer.yaml')).toBeUndefined();
    expect(agentDocumentKeyForPath('.shipfox/agents/reviewer.md')).toBeUndefined();
    expect(agentDocumentKeyForPath('.shipfox/agents/Reviewer.yaml')).toBeUndefined();
    expect(agentDocumentKeyForPath('.shipfox/workflows/ci.yaml')).toBeUndefined();
  });
});

describe('buildAgentDocumentJsonSchema', () => {
  it('publishes every agent field with a description', () => {
    const schema = buildAgentDocumentJsonSchema();
    const properties = schema.properties as Record<string, {description?: string}>;

    expect(schema).toMatchObject({title: 'Shipfox Agent'});
    expect(Object.keys(properties).sort()).toEqual([
      'description',
      'instructions',
      'integrations',
      'model',
      'name',
      'provider',
      'thinking',
    ]);
    for (const property of Object.values(properties)) {
      expect(property.description).toEqual(expect.any(String));
    }
  });
});
