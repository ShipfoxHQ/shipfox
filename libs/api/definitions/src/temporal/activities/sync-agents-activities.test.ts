import {and, eq, isNull} from 'drizzle-orm';
import {db, listProjectAgents} from '#db/index.js';
import {workflowDefinitions} from '#db/schema/definitions.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {AGENT_FOLDER, repositorySourceControl} from '#test/fixtures/agent-repository.js';
import {createDefinitionSyncActivities} from './sync-activities.js';

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({heartbeat: vi.fn()}),
  },
}));

const SOURCE_REPOSITORY_ID = 'gitea:gitea-owner/platform';
const WORKFLOW_PATH = '.shipfox/workflows/ci.yml';
const WORKFLOW =
  'name: CI\nrunner: ubuntu-latest\njobs:\n  build:\n    steps:\n      - run: pnpm test\n';
const REVIEWER = 'description: Reviews pull requests.\ninstructions: Review the diff.\n';
const REVIEWER_PATH = `${AGENT_FOLDER}reviewer.yml`;

describe('agent files in definition sync', () => {
  let projectId: string;
  let workspaceId: string;
  let sourceConnectionId: string;
  let files: Record<string, string>;
  let currentSource: {sourceConnectionId: string; sourceExternalRepositoryId: string};

  beforeEach(() => {
    projectId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    currentSource = {sourceConnectionId, sourceExternalRepositoryId: SOURCE_REPOSITORY_ID};
    files = {[WORKFLOW_PATH]: WORKFLOW};
  });

  /** Runs the three sync stages in the order the workflow does. */
  async function sync() {
    const activities = createDefinitionSyncActivities(
      repositorySourceControl(files),
      {getValidationCatalogV2: () => agentValidationCatalog} as never,
      {
        getProjectById: ({projectId: id}: {projectId: string}) =>
          Promise.resolve({
            project: {id, workspaceId, name: 'Project', ...currentSource},
          }),
      },
    );
    const input = {
      projectId,
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
      sourceRef: 'main',
    };
    const discovered = await activities.discoverDefinitionFiles(input);
    const agents = await activities.syncDefinitionAgents({
      ...input,
      paths: discovered.agentPaths,
      nestedPaths: discovered.nestedAgentPaths,
      truncated: discovered.agentFilesTruncated,
    });
    const workflows = await activities.fetchAndApplyDefinitionWorkflowsV2({
      ...input,
      paths: discovered.workflowPaths,
    });
    return {discovered, agents, workflows};
  }

  async function liveWorkflowPaths() {
    const rows = await db()
      .select({configPath: workflowDefinitions.configPath})
      .from(workflowDefinitions)
      .where(
        and(eq(workflowDefinitions.projectId, projectId), isNull(workflowDefinitions.deletedAt)),
      );
    return rows.map((row) => row.configPath);
  }

  it('stores a valid agent file under its file name', async () => {
    files[REVIEWER_PATH] = `name: Code reviewer\n${REVIEWER}`;

    const {agents} = await sync();

    expect(agents).toEqual({appliedCount: 1, deletedCount: 0, diagnostics: []});
    const stored = await listProjectAgents(projectId);
    expect(stored).toEqual([
      expect.objectContaining({
        key: 'reviewer',
        configPath: REVIEWER_PATH,
        errors: [],
        config: {
          name: 'Code reviewer',
          description: 'Reviews pull requests.',
          instructions: 'Review the diff.',
        },
      }),
    ]);
  });

  it('leaves workflows syncing when an agent file is invalid', async () => {
    files[REVIEWER_PATH] = 'description: Reviews pull requests.\n';

    const {agents, workflows} = await sync();

    expect(await liveWorkflowPaths()).toEqual([WORKFLOW_PATH]);
    expect(workflows.appliedCount).toBe(1);
    expect(agents.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-agent',
        severity: 'error',
        filePath: REVIEWER_PATH,
        path: 'instructions',
      }),
    ]);
    expect(await listProjectAgents(projectId)).toEqual([]);
  });

  it('syncs a repository with only agent files', async () => {
    files = {[REVIEWER_PATH]: REVIEWER};

    const {discovered, workflows} = await sync();

    expect(discovered.workflowPaths).toEqual([]);
    expect(workflows).toEqual({appliedCount: 0, deletedCount: 0, diagnostics: []});
    expect((await listProjectAgents(projectId)).map((agent) => agent.key)).toEqual(['reviewer']);
  });

  it('deletes the row of a deleted file', async () => {
    files[REVIEWER_PATH] = REVIEWER;
    files[`${AGENT_FOLDER}shippy.yml`] = 'model: claude-opus-5-5\n';
    await sync();

    delete files[REVIEWER_PATH];
    const {agents} = await sync();

    expect(agents.deletedCount).toBe(1);
    expect((await listProjectAgents(projectId)).map((agent) => agent.key)).toEqual(['shippy']);
  });

  it('deletes every row when the agent folder is gone', async () => {
    files[REVIEWER_PATH] = REVIEWER;
    await sync();

    delete files[REVIEWER_PATH];
    await sync();

    expect(await listProjectAgents(projectId)).toEqual([]);
  });

  it('reports a nested file and creates no agent', async () => {
    files[`${AGENT_FOLDER}team/triage.yml`] = REVIEWER;

    const {agents} = await sync();

    expect(agents.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-agent',
        severity: 'error',
        filePath: `${AGENT_FOLDER}team/triage.yml`,
      }),
    ]);
    expect(await listProjectAgents(projectId)).toEqual([]);
  });

  it('creates a new agent for a renamed file and deletes the old one', async () => {
    files[REVIEWER_PATH] = REVIEWER;
    await sync();
    const [before] = await listProjectAgents(projectId);

    delete files[REVIEWER_PATH];
    files[`${AGENT_FOLDER}auditor.yml`] = REVIEWER;
    await sync();

    const after = await listProjectAgents(projectId);
    expect(after.map((agent) => agent.key)).toEqual(['auditor']);
    expect(after[0]?.id).not.toBe(before?.id);
  });

  it('keeps the last valid config and records the error when a file turns invalid', async () => {
    files[REVIEWER_PATH] = REVIEWER;
    await sync();

    files[REVIEWER_PATH] = 'description: Reviews pull requests.\nharness: claude\n';
    await sync();

    const [broken] = await listProjectAgents(projectId);
    expect(broken?.config).toEqual({
      description: 'Reviews pull requests.',
      instructions: 'Review the diff.',
    });
    expect(broken?.errors).toEqual([expect.objectContaining({message: expect.any(String)})]);

    files[REVIEWER_PATH] = 'description: Reviews pull requests.\ninstructions: Review it all.\n';
    await sync();

    const [fixed] = await listProjectAgents(projectId);
    expect(fixed?.config.instructions).toBe('Review it all.');
    expect(fixed?.errors).toEqual([]);
  });

  it('changes nothing when the project points at another source', async () => {
    files[REVIEWER_PATH] = REVIEWER;
    await sync();

    files[REVIEWER_PATH] = 'description: Changed.\ninstructions: Changed.\n';
    delete files[`${AGENT_FOLDER}other.yml`];
    currentSource = {sourceConnectionId, sourceExternalRepositoryId: 'github:acme/config'};
    const {agents} = await sync();

    expect(agents).toEqual({appliedCount: 0, deletedCount: 0, diagnostics: []});
    const [stored] = await listProjectAgents(projectId);
    expect(stored?.config.description).toBe('Reviews pull requests.');
  });

  it('changes no row when the agent folder listing is incomplete', async () => {
    files[REVIEWER_PATH] = REVIEWER;
    await sync();
    const activities = createDefinitionSyncActivities(repositorySourceControl({}), {} as never, {
      getProjectById: () =>
        Promise.resolve({project: {id: projectId, workspaceId, name: 'Project', ...currentSource}}),
    });

    const result = await activities.syncDefinitionAgents({
      projectId,
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
      sourceRef: 'main',
      paths: [],
      nestedPaths: [],
      truncated: true,
    });

    expect(result.deletedCount).toBe(0);
    expect(result.diagnostics).toEqual([expect.objectContaining({code: 'invalid-agent'})]);
    expect(await listProjectAgents(projectId)).toHaveLength(1);
  });

  it('fails discovery only when both folders are empty', async () => {
    files = {};

    await expect(sync()).rejects.toMatchObject({type: 'no-workflow-files'});
  });
});
