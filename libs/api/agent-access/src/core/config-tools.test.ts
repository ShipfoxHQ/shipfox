import {
  commitConfigChangesResultSchema,
  listConfigFilesResultSchema,
  readConfigFileResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createAgentAccessConfigTools} from './config-tools.js';
import type {AgentAccessTool} from './tools.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const context = {workspaceId, userId} as AgentAccessContext;
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const WORKFLOW = '.shipfox/workflows/triage.yml';
const methods = integrationsInterModuleContract.methods;

function toolNamed(name: string, integrations: Partial<IntegrationsModuleClient>): AgentAccessTool {
  const tool = createAgentAccessConfigTools(integrations as IntegrationsModuleClient).find(
    (candidate) => candidate.name === name,
  );
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool;
}

describe('config tools', () => {
  test('are two read tools and one action tool', () => {
    const tools = createAgentAccessConfigTools({} as IntegrationsModuleClient);

    expect(tools.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([
      ['list_config_files', true],
      ['read_config_file', true],
      ['commit_config_changes', false],
    ]);
  });
});

describe('list_config_files', () => {
  test('lists the files with the commit it read', async () => {
    const listConfigFiles = vi.fn().mockResolvedValue({
      commit: HEAD,
      files: [{path: WORKFLOW, type: 'file', size: null}],
      nextCursor: null,
    });
    const tool = toolNamed('list_config_files', {listConfigFiles});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, ref: 'shipfox/add-triage', limit: 10},
    });

    expect(listConfigFiles).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      ref: 'shipfox/add-triage',
      limit: 10,
    });
    expect(listConfigFilesResultSchema.parse(response.result)).toEqual({
      commit: HEAD,
      files: [{path: WORKFLOW, type: 'file', size_bytes: null}],
      next_cursor: null,
    });
  });

  test('answers not-found for a project outside the workspace', async () => {
    const listConfigFiles = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(methods.listConfigFiles, 'project-not-found', {projectId}),
      );
    const tool = toolNamed('list_config_files', {listConfigFiles});

    const response = await tool.execute({context, arguments: {project_id: projectId}});

    expect(response).toMatchObject({ok: false, error: {code: 'not-found'}});
  });

  test('answers invalid-request for input it does not accept', async () => {
    const tool = toolNamed('list_config_files', {});

    const response = await tool.execute({context, arguments: {project_id: 'nope'}});

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
  });
});

describe('read_config_file', () => {
  test('reads a file at a ref', async () => {
    const readConfigFile = vi
      .fn()
      .mockResolvedValue({path: WORKFLOW, commit: HEAD, content: 'name: Triage\n'});
    const tool = toolNamed('read_config_file', {readConfigFile});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, path: WORKFLOW, ref: OTHER},
    });

    expect(readConfigFile).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      path: WORKFLOW,
      ref: OTHER,
    });
    expect(readConfigFileResultSchema.parse(response.result).content).toBe('name: Triage\n');
  });

  test('answers not-found for a missing file', async () => {
    const readConfigFile = vi.fn().mockRejectedValue(
      createInterModuleKnownError(methods.readConfigFile, 'provider-failure', {
        reason: 'file-not-found',
      }),
    );
    const tool = toolNamed('read_config_file', {readConfigFile});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, path: WORKFLOW},
    });

    expect(response).toMatchObject({ok: false, error: {code: 'not-found'}});
  });
});

describe('commit_config_changes', () => {
  const input = {
    project_id: projectId,
    branch: 'shipfox/add-triage',
    expected_head: HEAD,
    message: 'Add triage',
    changes: [
      {path: WORKFLOW, content: 'name: Triage\n'},
      {path: '.shipfox/workflows/old.yml', delete: true},
    ],
  };

  test('commits the changes as the calling member', async () => {
    const commitConfigChanges = vi
      .fn()
      .mockResolvedValue({branch: 'shipfox/add-triage', commit: OTHER, parent: HEAD});
    const tool = toolNamed('commit_config_changes', {commitConfigChanges});

    const response = await tool.execute({context, arguments: input});

    expect(commitConfigChanges).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      branch: 'shipfox/add-triage',
      expectedHead: HEAD,
      message: 'Add triage',
      changes: [
        {path: WORKFLOW, content: 'name: Triage\n'},
        {path: '.shipfox/workflows/old.yml', content: null},
      ],
      actor: {id: userId, name: expect.any(String)},
    });
    expect(commitConfigChangesResultSchema.parse(response.result)).toEqual({
      branch: 'shipfox/add-triage',
      commit: OTHER,
      parent: HEAD,
    });
  });

  test('omits the expected head on the first commit to a branch', async () => {
    const commitConfigChanges = vi
      .fn()
      .mockResolvedValue({branch: 'shipfox/add-triage', commit: OTHER, parent: HEAD});
    const tool = toolNamed('commit_config_changes', {commitConfigChanges});

    await tool.execute({context, arguments: {...input, expected_head: undefined}});

    expect(commitConfigChanges.mock.calls[0]?.[0]).not.toHaveProperty('expectedHead');
  });

  test('names the repository when the config is linked', async () => {
    const commitConfigChanges = vi.fn().mockRejectedValue(
      createInterModuleKnownError(methods.commitConfigChanges, 'repository-read-only', {
        repository: 'acme/app',
      }),
    );
    const tool = toolNamed('commit_config_changes', {commitConfigChanges});

    const response = await tool.execute({context, arguments: input});

    expect(response).toMatchObject({
      ok: false,
      error: {code: 'repository-read-only', details: {repository: 'acme/app'}},
    });
    expect(JSON.stringify(response)).toContain('acme/app');
  });

  test('returns the current head with stale-head', async () => {
    const commitConfigChanges = vi.fn().mockRejectedValue(
      createInterModuleKnownError(methods.commitConfigChanges, 'stale-head', {
        branch: 'shipfox/add-triage',
        head: OTHER,
      }),
    );
    const tool = toolNamed('commit_config_changes', {commitConfigChanges});

    const response = await tool.execute({context, arguments: input});

    expect(response).toMatchObject({
      ok: false,
      error: {code: 'stale-head', details: {head: OTHER}},
    });
  });

  test.each([
    ['path-not-allowed', {path: 'src/index.ts'}, {path: 'src/index.ts'}],
    ['content-not-text', {path: WORKFLOW}, {path: WORKFLOW}],
    ['protected-branch', {branch: 'main'}, undefined],
    ['commit-too-large', {}, undefined],
  ] as const)('maps %s', async (code, details, expectedDetails) => {
    const commitConfigChanges = vi
      .fn()
      .mockRejectedValue(createInterModuleKnownError(methods.commitConfigChanges, code, details));
    const tool = toolNamed('commit_config_changes', {commitConfigChanges});

    const response = await tool.execute({context, arguments: input});

    expect(response).toMatchObject({ok: false, error: {code}});
    if (expectedDetails) expect(response).toMatchObject({error: {details: expectedDetails}});
  });

  test.each([
    ['no changes', {changes: []}],
    ['a change with content and delete', {changes: [{path: WORKFLOW, content: 'x', delete: true}]}],
  ])('refuses %s before calling Integrations', async (_label, override) => {
    const commitConfigChanges = vi.fn();
    const tool = toolNamed('commit_config_changes', {commitConfigChanges});

    const response = await tool.execute({context, arguments: {...input, ...override}});

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(commitConfigChanges).not.toHaveBeenCalled();
  });
});
