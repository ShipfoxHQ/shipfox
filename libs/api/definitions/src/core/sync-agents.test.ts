import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {DefinitionsSourceControl} from './integrations.js';
import {fetchAndParseAgents} from './sync-agents.js';

const context = {
  workspaceId: 'workspace-1',
  sourceConnectionId: 'connection-1',
  sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
  ref: 'abc123',
  agentValidationCatalog,
};

const reviewerYaml = `
name: Reviewer
description: Reviews pull requests.
instructions:
  - Be brief.
  - file: ./.shipfox/prompts/review.md
model: claude-opus-4-8
provider: anthropic
thinking: high
`;

function repositorySourceControl(repository: Record<string, string>): DefinitionsSourceControl {
  return {
    resolveRepository: vi.fn(),
    listFiles: vi.fn(),
    fetchFile: vi.fn(({path, ref}: {path: string; ref: string}) => {
      const content = repository[path];
      if (content === undefined) {
        return Promise.reject(
          createInterModuleKnownError(
            integrationsInterModuleContract.methods.fetchSourceFile,
            'provider-failure',
            {reason: 'file-not-found'},
          ),
        );
      }
      return Promise.resolve({path, ref, content});
    }),
  };
}

function parse(repository: Record<string, string>, paths = Object.keys(repository)) {
  return fetchAndParseAgents({
    ...context,
    paths: paths.filter((path) => path.startsWith('.shipfox/agents/')),
    sourceControl: repositorySourceControl(repository),
  });
}

describe('fetchAndParseAgents', () => {
  it('parses a custom agent, inlines its prompt file, and keys it by file name', async () => {
    const result = await parse({
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
      '.shipfox/prompts/review.md': 'Report only real bugs.\n',
    });

    expect(result.invalid).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toEqual([
      expect.objectContaining({
        key: 'reviewer',
        path: '.shipfox/agents/reviewer.yaml',
        name: 'Reviewer',
        description: 'Reviews pull requests.',
        instructions: 'Be brief.\n\nReport only real bugs.',
      }),
    ]);
  });

  it('accepts an empty shippy file', async () => {
    const result = await parse({'.shipfox/agents/shippy.yaml': ''});

    expect(result.valid).toEqual([
      expect.objectContaining({key: 'shippy', instructions: null, document: {}}),
    ]);
  });

  it('keeps the other files when one is invalid', async () => {
    const result = await parse({
      '.shipfox/agents/shippy.yml': 'instructions: Prefer short answers.',
      '.shipfox/agents/broken.yaml': 'name: Broken',
    });

    expect(result.valid.map((agent) => agent.key)).toEqual(['shippy']);
    expect(result.invalid).toEqual([
      {
        key: 'broken',
        path: '.shipfox/agents/broken.yaml',
        error: {
          message: 'A custom agent requires "description".',
          diagnostics: [
            expect.objectContaining({path: 'description', severity: 'error'}),
            expect.objectContaining({path: 'instructions', severity: 'error'}),
          ],
        },
      },
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'agent-file-invalid',
        filePath: '.shipfox/agents/broken.yaml',
        path: 'description',
      }),
      expect.objectContaining({filePath: '.shipfox/agents/broken.yaml', path: 'instructions'}),
    ]);
  });

  it('reports a nested file without a key, so it creates no agent', async () => {
    const result = await parse({'.shipfox/agents/team/reviewer.yaml': reviewerYaml});

    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'agent-file-invalid',
        message: expect.stringContaining('is nested'),
        filePath: '.shipfox/agents/team/reviewer.yaml',
      }),
    ]);
  });

  it('reports invalid YAML and a missing prompt file against the file', async () => {
    const result = await parse({
      '.shipfox/agents/syntax.yaml': 'name: [',
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
    });

    expect(result.valid).toEqual([]);
    expect(result.invalid.map((agent) => agent.key).sort()).toEqual(['reviewer', 'syntax']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Invalid agent YAML syntax'),
          filePath: '.shipfox/agents/syntax.yaml',
        }),
        expect.objectContaining({
          message: expect.stringContaining('was not found at this commit'),
          path: 'instructions.1',
          filePath: '.shipfox/agents/reviewer.yaml',
        }),
      ]),
    );
  });

  it('checks the model against the catalog', async () => {
    const result = await parse({
      '.shipfox/agents/shippy.yaml': 'provider: anthropic\nmodel: not-a-model',
    });

    expect(result.valid).toEqual([]);
    expect(result.invalid[0]?.error.diagnostics).toEqual([
      expect.objectContaining({code: 'invalid-model', path: 'model'}),
    ]);
  });

  it('ignores a second file for the same key', async () => {
    const result = await parse({
      '.shipfox/agents/shippy.yaml': 'instructions: A',
      '.shipfox/agents/shippy.yml': 'instructions: B',
    });

    expect(result.valid).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({message: expect.stringContaining('already defines the agent')}),
    ]);
  });

  it('changes the hash when only the prompt file changes', async () => {
    const first = await parse({
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
      '.shipfox/prompts/review.md': 'One.',
    });
    const second = await parse({
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
      '.shipfox/prompts/review.md': 'Two.',
    });

    expect(first.valid[0]?.contentHash).not.toBe(second.valid[0]?.contentHash);
  });

  it('lets a provider outage propagate', async () => {
    const source = repositorySourceControl({});
    const outage = createInterModuleKnownError(
      integrationsInterModuleContract.methods.fetchSourceFile,
      'provider-failure',
      {reason: 'provider-unavailable'},
    );
    vi.mocked(source.fetchFile).mockRejectedValue(outage);

    await expect(
      fetchAndParseAgents({
        ...context,
        paths: ['.shipfox/agents/shippy.yaml'],
        sourceControl: source,
      }),
    ).rejects.toBe(outage);
  });
});
