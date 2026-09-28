import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {decodeActionBundle} from '@shipfox/workflow-document';
import {collectActionReferences} from './collect-action-references.js';
import {ActionResolutionError} from './errors.js';
import {
  MAX_ACTION_BYTES,
  MAX_ACTION_FILE_BYTES,
  MAX_ACTION_FILES,
  MAX_ACTIONS_PER_WORKFLOW,
  readActionDirectory,
  resolveWorkflowActions,
} from './resolve-actions.js';
import {parseWorkflowYaml} from './workflow-yaml/index.js';

type RepositoryEntry = {
  content?: string;
  type?: 'file' | 'symlink' | 'submodule';
  size?: number | null;
  binary?: boolean;
};

const manifestYaml = `
name: Slack thread
main: index.ts
inputs:
  channel:
    type: string
    required: true
outputs:
  markdown:
    type: string
`;

function fakeSourceControl(repository: Record<string, RepositoryEntry>) {
  const listFiles = vi.fn(({prefix, limit}: {prefix: string; limit: number}) => {
    const files = Object.entries(repository)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, entry]) => ({
        path,
        type: entry.type ?? ('file' as const),
        size:
          entry.size === undefined ? Buffer.byteLength(entry.content ?? '', 'utf8') : entry.size,
      }));
    return Promise.resolve({
      files: files.slice(0, limit),
      nextCursor: files.length > limit ? 'next' : null,
    });
  });
  const fetchFile = vi.fn(({path, ref}: {path: string; ref: string}) => {
    const entry = repository[path];
    if (entry?.binary) {
      return Promise.reject(
        createInterModuleKnownError(
          integrationsInterModuleContract.methods.fetchSourceFile,
          'provider-failure',
          {reason: 'binary-file-unsupported'},
        ),
      );
    }
    if (entry?.content === undefined) {
      return Promise.reject(
        createInterModuleKnownError(
          integrationsInterModuleContract.methods.fetchSourceFile,
          'provider-failure',
          {reason: 'file-not-found'},
        ),
      );
    }
    return Promise.resolve({path, ref, content: entry.content});
  });
  return {listFiles, fetchFile};
}

function sourceContext(repository: Record<string, RepositoryEntry>) {
  return {
    workspaceId: 'workspace-1',
    sourceConnectionId: 'connection-1',
    sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
    sourceControl: fakeSourceControl(repository),
    ref: 'abc123',
  };
}

function slackAction(): Record<string, RepositoryEntry> {
  return {
    '.shipfox/actions/slack/action.yml': {content: manifestYaml},
    '.shipfox/actions/slack/index.ts': {content: 'export default 1;\n'},
    '.shipfox/actions/slack/lib/format.ts': {content: 'export const x = 1;\n'},
  };
}

function workflow(path: string, uses: string[]) {
  const steps = ['      - run: echo hi', ...uses.map((use) => `      - uses: ${use}`)].join('\n');
  return {
    path,
    document: parseWorkflowYaml(
      `name: CI\nrunner: ubuntu-latest\njobs:\n  build:\n    steps:\n${steps}\n`,
      {actions: true},
    ),
  };
}

async function captureError(promise: Promise<unknown>): Promise<ActionResolutionError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ActionResolutionError)) {
    throw new Error(`Expected an ActionResolutionError, got ${String(error)}`);
  }
  return error;
}

describe('collectActionReferences', () => {
  it('returns each uses path once across jobs', () => {
    const document = parseWorkflowYaml(
      `
name: CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - uses: ./.shipfox/actions/slack
      - run: echo hi
      - uses: ./.shipfox/actions/linear
  test:
    steps:
      - uses: ./.shipfox/actions/slack
`,
      {actions: true},
    );

    const result = collectActionReferences(document);

    expect(result).toEqual(['./.shipfox/actions/slack', './.shipfox/actions/linear']);
  });
});

describe('readActionDirectory', () => {
  it('reads the directory, parses the manifest, and builds the bundle', async () => {
    const context = sourceContext(slackAction());

    const result = await readActionDirectory({...context, uses: './.shipfox/actions/slack'});

    expect(context.sourceControl.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: '.shipfox/actions/slack/',
        ref: 'abc123',
        limit: MAX_ACTION_FILES,
      }),
    );
    expect(result.manifestPath).toBe('.shipfox/actions/slack/action.yml');
    expect(result.manifest).toMatchObject({name: 'Slack thread', main: 'index.ts'});
    expect(result.bundle.fileCount).toBe(3);
    const decoded = await decodeActionBundle({
      gzip: result.bundle.gzip,
      digest: result.bundle.digest,
    });
    expect(decoded.map((file) => file.path)).toEqual(['action.yml', 'index.ts', 'lib/format.ts']);
  });

  it('accepts action.yaml', async () => {
    const context = sourceContext({
      '.shipfox/actions/slack/action.yaml': {content: manifestYaml},
      '.shipfox/actions/slack/index.ts': {content: 'export default 1;\n'},
    });

    const result = await readActionDirectory({...context, uses: './.shipfox/actions/slack'});

    expect(result.manifestPath).toBe('.shipfox/actions/slack/action.yaml');
  });

  it('gives the same digest for the same files', async () => {
    const first = await readActionDirectory({
      ...sourceContext(slackAction()),
      uses: './.shipfox/actions/slack',
    });
    const second = await readActionDirectory({
      ...sourceContext(slackAction()),
      uses: './.shipfox/actions/slack',
    });

    expect(second.bundle.digest).toBe(first.bundle.digest);
  });

  it('rejects a directory without a manifest', async () => {
    const context = sourceContext({
      '.shipfox/actions/slack/index.ts': {content: 'export default 1;\n'},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-not-found');
    expect(error.message).toBe('No action.yml or action.yaml found in ./.shipfox/actions/slack');
  });

  it('rejects a missing directory', async () => {
    const context = sourceContext({});

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-not-found');
  });

  it('does not match a sibling directory sharing the name prefix', async () => {
    const context = sourceContext({
      '.shipfox/actions/slack-v2/action.yml': {content: manifestYaml},
      '.shipfox/actions/slack-v2/index.ts': {content: 'export default 1;\n'},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-not-found');
  });

  it('rejects a manifest that fails the schema', async () => {
    const context = sourceContext({
      '.shipfox/actions/slack/action.yml': {content: 'name: Slack\nmain: index.ts\nunknown: 1\n'},
      '.shipfox/actions/slack/index.ts': {content: 'export default 1;\n'},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-invalid');
    expect(error.filePath).toBe('.shipfox/actions/slack/action.yml');
    expect(error.details.length).toBeGreaterThan(0);
  });

  it('rejects a manifest with invalid YAML syntax', async () => {
    const context = sourceContext({
      '.shipfox/actions/slack/action.yml': {content: 'name: [unclosed\n'},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-invalid');
    expect(error.filePath).toBe('.shipfox/actions/slack/action.yml');
  });

  it('rejects a manifest whose main file is missing', async () => {
    const context = sourceContext({
      '.shipfox/actions/slack/action.yml': {content: 'name: Slack\nmain: src/index.ts\n'},
      '.shipfox/actions/slack/index.ts': {content: 'export default 1;\n'},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-invalid');
    expect(error.details).toEqual([
      {message: 'Action main file src/index.ts is not in ./.shipfox/actions/slack', path: 'main'},
    ]);
  });

  it.each([{type: 'symlink' as const}, {type: 'submodule' as const}])('rejects a $type', async ({
    type,
  }) => {
    const context = sourceContext({
      ...slackAction(),
      '.shipfox/actions/slack/linked': {type, size: null},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-unsupported-file');
    expect(error.filePath).toBe('.shipfox/actions/slack/linked');
    expect(context.sourceControl.fetchFile).not.toHaveBeenCalled();
  });

  it('rejects a file that is not UTF-8 text', async () => {
    const context = sourceContext({
      ...slackAction(),
      '.shipfox/actions/slack/logo.png': {binary: true, size: 10},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-unsupported-file');
    expect(error.message).toBe('Action file is not UTF-8 text: .shipfox/actions/slack/logo.png');
  });

  it('rejects more files than the limit', async () => {
    const repository = slackAction();
    for (let index = 0; index < MAX_ACTION_FILES; index += 1) {
      repository[`.shipfox/actions/slack/helpers/${index}.ts`] = {content: ''};
    }
    const context = sourceContext(repository);

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-too-large');
    expect(error.message).toBe(
      `Action ./.shipfox/actions/slack has more than ${MAX_ACTION_FILES} files`,
    );
  });

  it('accepts exactly the file limit', async () => {
    const repository = slackAction();
    for (let index = 3; index < MAX_ACTION_FILES; index += 1) {
      repository[`.shipfox/actions/slack/helpers/${index}.ts`] = {content: ''};
    }
    const context = sourceContext(repository);

    const result = await readActionDirectory({...context, uses: './.shipfox/actions/slack'});

    expect(result.bundle.fileCount).toBe(MAX_ACTION_FILES);
  });

  it('rejects a listed file above the per-file limit before fetching', async () => {
    const context = sourceContext({
      ...slackAction(),
      '.shipfox/actions/slack/data.json': {size: MAX_ACTION_FILE_BYTES + 1},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-too-large');
    expect(error.filePath).toBe('.shipfox/actions/slack/data.json');
    expect(context.sourceControl.fetchFile).not.toHaveBeenCalled();
  });

  it('rejects a fetched file above the per-file limit when the listing has no size', async () => {
    const context = sourceContext({
      ...slackAction(),
      '.shipfox/actions/slack/data.json': {
        content: 'a'.repeat(MAX_ACTION_FILE_BYTES + 1),
        size: null,
      },
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-too-large');
    expect(error.message).toBe(
      `Action file is larger than ${MAX_ACTION_FILE_BYTES} bytes: .shipfox/actions/slack/data.json`,
    );
  });

  it('rejects a file the provider refuses as too large', async () => {
    const sourceControl = fakeSourceControl(slackAction());
    sourceControl.fetchFile.mockRejectedValueOnce(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.fetchSourceFile,
        'provider-failure',
        {reason: 'content-too-large'},
      ),
    );

    const error = await captureError(
      readActionDirectory({
        ...sourceContext({}),
        sourceControl,
        uses: './.shipfox/actions/slack',
      }),
    );

    expect(error.code).toBe('action-too-large');
  });

  it('rejects a directory above the total size limit', async () => {
    const half = 'a'.repeat(MAX_ACTION_BYTES / 2);
    const context = sourceContext({
      ...slackAction(),
      '.shipfox/actions/slack/a.txt': {content: half, size: null},
      '.shipfox/actions/slack/b.txt': {content: half, size: null},
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-too-large');
    expect(error.message).toBe(
      `Action ./.shipfox/actions/slack is larger than ${MAX_ACTION_BYTES} bytes`,
    );
  });

  it('counts UTF-8 bytes, not characters', async () => {
    // Four bytes and two UTF-16 code units per character.
    const context = sourceContext({
      ...slackAction(),
      '.shipfox/actions/slack/emoji.txt': {
        content: '🦊'.repeat(MAX_ACTION_FILE_BYTES / 4 + 1),
        size: null,
      },
    });

    const error = await captureError(
      readActionDirectory({...context, uses: './.shipfox/actions/slack'}),
    );

    expect(error.code).toBe('action-too-large');
    expect(error.filePath).toBe('.shipfox/actions/slack/emoji.txt');
  });

  it('lets other source failures through for sync classification', async () => {
    const sourceControl = fakeSourceControl(slackAction());
    const failure = createInterModuleKnownError(
      integrationsInterModuleContract.methods.listSourceFiles,
      'provider-failure',
      {reason: 'rate-limited'},
    );
    sourceControl.listFiles.mockRejectedValueOnce(failure);

    const result = readActionDirectory({
      ...sourceContext({}),
      sourceControl,
      uses: './.shipfox/actions/slack',
    });

    await expect(result).rejects.toBe(failure);
  });
});

describe('resolveWorkflowActions', () => {
  it('reads an action shared across workflows once', async () => {
    const context = sourceContext({
      ...slackAction(),
      '.shipfox/actions/linear/action.yml': {content: 'name: Linear\nmain: index.mjs\n'},
      '.shipfox/actions/linear/index.mjs': {content: 'export default 1;\n'},
    });

    const result = await resolveWorkflowActions({
      ...context,
      workflows: [
        workflow('.shipfox/workflows/a.yml', ['./.shipfox/actions/slack']),
        workflow('.shipfox/workflows/b.yml', [
          './.shipfox/actions/slack',
          './.shipfox/actions/linear',
        ]),
      ],
    });

    expect([...result.keys()]).toEqual(['./.shipfox/actions/slack', './.shipfox/actions/linear']);
    expect(result.get('./.shipfox/actions/linear')?.manifest.name).toBe('Linear');
    expect(context.sourceControl.listFiles).toHaveBeenCalledTimes(2);
    expect(context.sourceControl.fetchFile).toHaveBeenCalledTimes(5);
  });

  it('reads nothing when no workflow uses an action', async () => {
    const context = sourceContext({});

    const result = await resolveWorkflowActions({
      ...context,
      workflows: [workflow('.shipfox/workflows/a.yml', [])],
    });

    expect(result.size).toBe(0);
    expect(context.sourceControl.listFiles).not.toHaveBeenCalled();
  });

  it('rejects a workflow file referencing more actions than the limit', async () => {
    const context = sourceContext({});
    const uses = Array.from(
      {length: MAX_ACTIONS_PER_WORKFLOW + 1},
      (_, index) => `./.shipfox/actions/a${index}`,
    );

    const error = await captureError(
      resolveWorkflowActions({
        ...context,
        workflows: [workflow('.shipfox/workflows/a.yml', uses)],
      }),
    );

    expect(error.code).toBe('action-too-large');
    expect(error.filePath).toBe('.shipfox/workflows/a.yml');
    expect(context.sourceControl.listFiles).not.toHaveBeenCalled();
  });

  it('allows the limit per workflow file, not across workflows', async () => {
    const repository: Record<string, RepositoryEntry> = {};
    const usesFor = (offset: number) =>
      Array.from({length: MAX_ACTIONS_PER_WORKFLOW}, (_, index) => {
        const name = `a${offset + index}`;
        repository[`.shipfox/actions/${name}/action.yml`] = {content: manifestYaml};
        repository[`.shipfox/actions/${name}/index.ts`] = {content: ''};
        return `./.shipfox/actions/${name}`;
      });
    const workflows = [
      workflow('.shipfox/workflows/a.yml', usesFor(0)),
      workflow('.shipfox/workflows/b.yml', usesFor(MAX_ACTIONS_PER_WORKFLOW)),
    ];

    const result = await resolveWorkflowActions({...sourceContext(repository), workflows});

    expect(result.size).toBe(MAX_ACTIONS_PER_WORKFLOW * 2);
  });
});
