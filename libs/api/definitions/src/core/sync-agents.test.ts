import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {
  AGENT_FOLDER,
  AGENT_SOURCE_CONTEXT,
  repositorySourceControl,
} from '#test/fixtures/agent-repository.js';
import {DefinitionSyncPermanentError} from './errors.js';
import {
  agentKeyForPath,
  discoverDefinitionFiles,
  fetchAndParseAgents,
  listAgentFiles,
  MAX_AGENT_FILES,
  parseAgentContent,
} from './sync-agents.js';

const WORKFLOW =
  'name: CI\nrunner: ubuntu-latest\njobs:\n  build:\n    steps:\n      - run: pnpm test\n';
const REVIEWER = 'description: Reviews pull requests.\ninstructions: Review the diff.\n';

async function parse(files: Record<string, string>) {
  const sourceControl = repositorySourceControl(files);
  const discovered = await listAgentFiles({
    ...AGENT_SOURCE_CONTEXT,
    sourceControl,
    ref: 'main',
  });
  return await fetchAndParseAgents({
    ...AGENT_SOURCE_CONTEXT,
    sourceControl,
    ref: 'main',
    paths: discovered.paths,
    nestedPaths: discovered.nestedPaths,
  });
}

describe('listAgentFiles', () => {
  it('lists the yaml files directly in the folder and separates nested ones', async () => {
    const sourceControl = repositorySourceControl({
      [`${AGENT_FOLDER}reviewer.yml`]: REVIEWER,
      [`${AGENT_FOLDER}shippy.yaml`]: '',
      [`${AGENT_FOLDER}README.md`]: '# Agents',
      [`${AGENT_FOLDER}team/triage.yml`]: REVIEWER,
      '.shipfox/workflows/ci.yml': WORKFLOW,
    });

    const result = await listAgentFiles({
      ...AGENT_SOURCE_CONTEXT,
      sourceControl,
      ref: 'main',
    });

    expect(result).toEqual({
      paths: [`${AGENT_FOLDER}reviewer.yml`, `${AGENT_FOLDER}shippy.yaml`],
      nestedPaths: [`${AGENT_FOLDER}team/triage.yml`],
      truncated: false,
    });
  });

  it('lists a configured folder, with or without a trailing slash', async () => {
    const sourceControl = repositorySourceControl({'.staging/agents/reviewer.yml': REVIEWER});

    const result = await listAgentFiles({
      ...AGENT_SOURCE_CONTEXT,
      sourceControl,
      ref: 'main',
      agentPath: '.staging/agents',
    });

    expect(result.paths).toEqual(['.staging/agents/reviewer.yml']);
  });

  it('reports an incomplete listing instead of a partial list', async () => {
    const sourceControl = repositorySourceControl({});
    vi.mocked(sourceControl.listFiles).mockResolvedValueOnce({
      files: [{path: `${AGENT_FOLDER}a.yml`, type: 'file', size: 1}],
      nextCursor: 'more',
    } as never);

    const result = await listAgentFiles({
      ...AGENT_SOURCE_CONTEXT,
      sourceControl,
      ref: 'main',
    });

    expect(result).toEqual({paths: [], nestedPaths: [], truncated: true});
    expect(sourceControl.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({limit: MAX_AGENT_FILES}),
    );
  });
});

describe('discoverDefinitionFiles', () => {
  it('returns both folders', async () => {
    const sourceControl = repositorySourceControl({
      '.shipfox/workflows/ci.yml': WORKFLOW,
      [`${AGENT_FOLDER}reviewer.yml`]: REVIEWER,
    });

    const result = await discoverDefinitionFiles({
      ...AGENT_SOURCE_CONTEXT,
      sourceControl,
      ref: 'main',
    });

    expect(result.workflowPaths).toEqual(['.shipfox/workflows/ci.yml']);
    expect(result.paths).toEqual([`${AGENT_FOLDER}reviewer.yml`]);
  });

  it('accepts a repository with only agent files', async () => {
    const sourceControl = repositorySourceControl({[`${AGENT_FOLDER}reviewer.yml`]: REVIEWER});

    const result = await discoverDefinitionFiles({
      ...AGENT_SOURCE_CONTEXT,
      sourceControl,
      ref: 'main',
    });

    expect(result.workflowPaths).toEqual([]);
    expect(result.paths).toEqual([`${AGENT_FOLDER}reviewer.yml`]);
  });

  it('accepts a repository with only workflow files', async () => {
    const sourceControl = repositorySourceControl({'.shipfox/workflows/ci.yml': WORKFLOW});

    const result = await discoverDefinitionFiles({
      ...AGENT_SOURCE_CONTEXT,
      sourceControl,
      ref: 'main',
    });

    expect(result.paths).toEqual([]);
    expect(result.workflowPaths).toEqual(['.shipfox/workflows/ci.yml']);
  });

  it('keeps no-workflow-files an error when both folders are empty', async () => {
    const sourceControl = repositorySourceControl({[`${AGENT_FOLDER}README.md`]: '# Agents'});

    const result = discoverDefinitionFiles({
      ...AGENT_SOURCE_CONTEXT,
      sourceControl,
      ref: 'main',
    });

    await expect(result).rejects.toBeInstanceOf(DefinitionSyncPermanentError);
    await expect(result).rejects.toMatchObject({code: 'no-workflow-files'});
  });
});

describe('fetchAndParseAgents', () => {
  it('names each agent after its file', async () => {
    const result = await parse({
      [`${AGENT_FOLDER}reviewer.yml`]: `name: Code reviewer\n${REVIEWER}`,
      [`${AGENT_FOLDER}shippy.yaml`]: 'instructions: Answer in French.\n',
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files).toEqual([
      expect.objectContaining({
        key: 'reviewer',
        valid: true,
        config: {
          name: 'Code reviewer',
          description: 'Reviews pull requests.',
          instructions: 'Review the diff.',
        },
      }),
      expect.objectContaining({
        key: 'shippy',
        valid: true,
        config: {instructions: 'Answer in French.'},
      }),
    ]);
  });

  it('treats an empty shippy file as no configuration', async () => {
    const result = await parse({[`${AGENT_FOLDER}shippy.yml`]: ''});

    expect(result.files).toEqual([
      expect.objectContaining({key: 'shippy', valid: true, config: {}}),
    ]);
  });

  it('rejects an empty custom agent file', async () => {
    const result = await parse({[`${AGENT_FOLDER}reviewer.yml`]: ''});

    expect(result.files).toEqual([
      {
        key: 'reviewer',
        configPath: `${AGENT_FOLDER}reviewer.yml`,
        valid: false,
        errors: [
          {message: 'A custom agent requires "description".', path: 'description'},
          {message: 'A custom agent requires "instructions".', path: 'instructions'},
        ],
      },
    ]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'invalid-agent',
      severity: 'error',
      filePath: `${AGENT_FOLDER}reviewer.yml`,
      path: 'description',
    });
  });

  it('keeps one invalid file from affecting the others', async () => {
    const result = await parse({
      [`${AGENT_FOLDER}broken.yml`]: 'description: [unclosed\n',
      [`${AGENT_FOLDER}reviewer.yml`]: REVIEWER,
    });

    expect(result.files.map((file) => [file.key, file.valid])).toEqual([
      ['broken', false],
      ['reviewer', true],
    ]);
  });

  it('reports a nested file and creates no agent for it', async () => {
    const result = await parse({[`${AGENT_FOLDER}team/triage.yml`]: REVIEWER});

    expect(result.files).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-agent',
        severity: 'error',
        filePath: `${AGENT_FOLDER}team/triage.yml`,
      }),
    ]);
  });

  it('rejects a harness field and an on field', async () => {
    const result = await parse({
      [`${AGENT_FOLDER}reviewer.yml`]: `${REVIEWER}harness: claude\non:\n  github: push\n`,
    });

    expect(result.files).toEqual([expect.objectContaining({key: 'reviewer', valid: false})]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'Unrecognized key',
    );
  });

  it('rejects a file name that cannot be a key', async () => {
    const result = await parse({[`${AGENT_FOLDER}Code Reviewer.yml`]: REVIEWER});

    expect(result.files).toEqual([expect.objectContaining({key: 'Code Reviewer', valid: false})]);
  });

  it('rejects a key claimed by both extensions and keeps the first path for the error', async () => {
    const result = await parse({
      [`${AGENT_FOLDER}reviewer.yml`]: REVIEWER,
      [`${AGENT_FOLDER}reviewer.yaml`]: REVIEWER,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({key: 'reviewer', valid: false});
    expect(result.diagnostics).toHaveLength(2);
  });

  it('joins file parts into the instructions and hashes the prompt files', async () => {
    const files = (promptText: string) => ({
      [`${AGENT_FOLDER}reviewer.yml`]:
        'description: Reviews.\ninstructions:\n  - Be brief.\n  - file: ./docs/review.md\n',
      'docs/review.md': promptText,
    });

    const first = await parse(files('Check the tests.\n'));
    const second = await parse(files('Check the types.\n'));

    expect(first.files[0]).toMatchObject({
      valid: true,
      config: {instructions: 'Be brief.\n\nCheck the tests.'},
    });
    const [firstFile] = first.files;
    const [secondFile] = second.files;
    expect(firstFile?.valid && secondFile?.valid && firstFile.contentHash).not.toBe(
      secondFile?.valid && secondFile.contentHash,
    );
  });

  it('reports a missing prompt file against the agent and keeps the others', async () => {
    const result = await parse({
      [`${AGENT_FOLDER}reviewer.yml`]:
        'description: Reviews.\ninstructions:\n  - file: ./docs/missing.md\n',
      [`${AGENT_FOLDER}triage.yml`]: REVIEWER,
    });

    expect(result.files.map((file) => [file.key, file.valid])).toEqual([
      ['reviewer', false],
      ['triage', true],
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'prompt-file-invalid',
        filePath: `${AGENT_FOLDER}reviewer.yml`,
      }),
    ]);
  });

  it('fails the sync when the repository cannot be read', async () => {
    const sourceControl = repositorySourceControl({[`${AGENT_FOLDER}reviewer.yml`]: REVIEWER});
    const timeout = createInterModuleKnownError(
      integrationsInterModuleContract.methods.fetchSourceFile,
      'provider-failure',
      {reason: 'timeout'},
    );
    vi.mocked(sourceControl.fetchFile).mockRejectedValueOnce(timeout);

    await expect(
      fetchAndParseAgents({
        ...AGENT_SOURCE_CONTEXT,
        sourceControl,
        ref: 'main',
        paths: [`${AGENT_FOLDER}reviewer.yml`],
        nestedPaths: [],
      }),
    ).rejects.toBe(timeout);
  });
});

describe('parseAgentContent', () => {
  it('rejects YAML that is not an object', () => {
    expect(parseAgentContent({content: '- a\n- b\n', key: 'reviewer'})).toEqual({
      valid: false,
      errors: [{message: 'An agent file must parse to an object.'}],
    });
  });
});

describe('agentKeyForPath', () => {
  it.each([
    ['.shipfox/agents/reviewer.yml', 'reviewer'],
    ['.shipfox/agents/reviewer.yaml', 'reviewer'],
  ])('maps %s to %s', (path, key) => {
    expect(agentKeyForPath(path)).toBe(key);
  });
});
