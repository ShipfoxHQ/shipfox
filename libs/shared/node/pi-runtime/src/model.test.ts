import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInMemoryCredentialStore, toPiRuntimeCredential} from '#credentials.js';
import {AgentConfigError} from '#errors.js';
import {createPiModel} from '#model.js';

const assertEgressAllowed = vi.fn().mockResolvedValue(undefined);

describe('createPiModel', () => {
  let home: string;
  let cwd: string;
  let previousHome: string | undefined;
  let previousAgentDir: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pi-runtime-home-'));
    cwd = process.cwd();
    previousHome = process.env.HOME;
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    process.chdir(cwd);
    await rm(home, {recursive: true, force: true});
  });

  it('builds a model with no models file and writes nothing to disk', async () => {
    const credentials = {api_key: 'sk-test'};
    const credentialStore = createInMemoryCredentialStore({
      anthropic: toPiRuntimeCredential('anthropic', credentials),
    });

    const {modelRuntime, model} = await createPiModel({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinking: 'default',
      credentials,
      credentialStore,
      customProvider: undefined,
      assertEgressAllowed,
      modelsPath: null,
    });

    expect(model.provider).toBe('anthropic');
    expect(modelRuntime.hasConfiguredAuth('anthropic')).toBe(true);
    expect(await readdir(home)).toEqual([]);
  });

  it('rejects a provider without credentials', async () => {
    await expect(
      createPiModel({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        thinking: 'medium',
        credentials: {},
        credentialStore: createInMemoryCredentialStore({}),
        customProvider: undefined,
        assertEgressAllowed,
        modelsPath: null,
      }),
    ).rejects.toEqual(
      new AgentConfigError(
        'No credentials configured for provider "anthropic". Verify the provider is configured for this workspace.',
        'provider_not_configured',
      ),
    );
  });
});
