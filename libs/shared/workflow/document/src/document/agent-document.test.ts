import {
  agentKeyFromFileName,
  buildAgentJsonSchema,
  InvalidAgentDocumentError,
  parseAgentDocument,
  SHIPPY_AGENT_KEY,
} from './agent-document.js';

function issuesOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidAgentDocumentError) {
      return error.validationError.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
    }
    throw error;
  }
  throw new Error('Expected the agent document to be rejected.');
}

describe('parseAgentDocument', () => {
  it('accepts a complete custom agent', () => {
    const document = {
      name: 'Reviewer',
      description: 'Reviews pull requests.',
      instructions: ['Review the diff.', {file: './docs/review.md'}],
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      thinking: 'high',
      integrations: [{connection: 'github', include: ['github.pull_requests.*']}],
    };

    expect(parseAgentDocument(document, {key: 'reviewer'})).toEqual(document);
  });

  it('requires a description and instructions from a custom agent', () => {
    expect(issuesOf(() => parseAgentDocument({}, {key: 'reviewer'}))).toEqual([
      {path: 'description', message: 'A custom agent requires "description".'},
      {path: 'instructions', message: 'A custom agent requires "instructions".'},
    ]);
  });

  it('accepts an empty shippy file', () => {
    expect(parseAgentDocument({}, {key: SHIPPY_AGENT_KEY})).toEqual({});
  });

  it('accepts a shippy file that adds instructions and a model', () => {
    const document = {instructions: 'Answer in French.', model: 'claude-opus-5-5'};

    expect(parseAgentDocument(document, {key: SHIPPY_AGENT_KEY})).toEqual(document);
  });

  it.each(['harness', 'on', 'key', 'tools'])('rejects the %s field', (field) => {
    const issues = issuesOf(() =>
      parseAgentDocument({[field]: 'x', description: 'd', instructions: 'i'}, {key: 'reviewer'}),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('Unrecognized key');
  });

  it('rejects a thinking template, because an agent has no expression context', () => {
    expect(
      issuesOf(() =>
        parseAgentDocument(
          {description: 'd', instructions: 'i', thinking: '$' + '{{ inputs.level }}'},
          {key: 'reviewer'},
        ),
      ),
    ).toHaveLength(1);
  });

  it.each([
    'Reviewer',
    'review er',
    '-reviewer',
    'a'.repeat(65),
    '',
  ])('rejects the key %j', (key) => {
    const issues = issuesOf(() => parseAgentDocument({description: 'd', instructions: 'i'}, {key}));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('Agent file names');
  });
});

describe('agentKeyFromFileName', () => {
  it.each([
    ['reviewer.yml', 'reviewer'],
    ['reviewer.yaml', 'reviewer'],
    ['reviewer.v2.yaml', 'reviewer.v2'],
  ])('maps %s to %s', (fileName, key) => {
    expect(agentKeyFromFileName(fileName)).toBe(key);
  });
});

describe('buildAgentJsonSchema', () => {
  it('lists the agent fields and no others', () => {
    const schema = buildAgentJsonSchema() as {properties: Record<string, unknown>};

    expect(Object.keys(schema.properties)).toEqual([
      'name',
      'description',
      'instructions',
      'provider',
      'model',
      'thinking',
      'integrations',
    ]);
  });
});
