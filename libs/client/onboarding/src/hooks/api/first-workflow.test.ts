import type {DefinitionList, ProjectList} from '@shipfox/client-projects';
import type {WorkflowRunListPage} from '@shipfox/client-workflows';
import {beforeEach, describe, expect, test} from '@shipfox/vitest/vi';
import {QueryClient} from '@tanstack/react-query';
import {firstWorkflowQueryOptions} from './first-workflow.js';

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listDefinitions: vi.fn(),
  listWorkflowRuns: vi.fn(),
}));

vi.mock('@shipfox/client-projects', () => ({
  listProjects: api.listProjects,
  listDefinitions: api.listDefinitions,
}));
vi.mock('@shipfox/client-workflows', () => ({listWorkflowRuns: api.listWorkflowRuns}));

const WORKSPACE_ID = 'workspace-1';
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

interface ProjectSeed {
  definitions?: number;
  devRun?: {id: string; createdAt: string};
}

function seedProjects(projects: Record<string, ProjectSeed>) {
  api.listProjects.mockResolvedValue({
    projects: Object.keys(projects).map((id) => ({id})),
    nextCursor: null,
  } as unknown as ProjectList);
  api.listDefinitions.mockImplementation(({projectId}: {projectId: string}) =>
    Promise.resolve({
      definitions: Array.from({length: projects[projectId]?.definitions ?? 0}, (_, index) => ({
        id: `${projectId}-definition-${index}`,
      })),
      sync: null,
      nextCursor: null,
    } as unknown as DefinitionList),
  );
  api.listWorkflowRuns.mockImplementation(({projectId}: {projectId: string}) => {
    const run = projects[projectId]?.devRun;
    return Promise.resolve({
      runs: run ? [run] : [],
      nextCursor: null,
      filteredTotalCount: null,
    } as unknown as WorkflowRunListPage);
  });
}

function read(scope: Parameters<typeof firstWorkflowQueryOptions>[0]) {
  return new QueryClient().fetchQuery(firstWorkflowQueryOptions(scope));
}

describe('first workflow progress', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('stays open when no project has a definition or a succeeded dev run', async () => {
    seedProjects({[PROJECT_A]: {}});

    expect(await read({kind: 'workspace', workspaceId: WORKSPACE_ID})).toEqual({state: 'open'});
  });

  test('reads only succeeded dev runs, one per project', async () => {
    seedProjects({[PROJECT_A]: {}});

    await read({kind: 'project', projectId: PROJECT_A});

    expect(api.listDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({projectId: PROJECT_A, limit: 1}),
    );
    expect(api.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_A,
        filters: {origin: 'dev', status: 'succeeded'},
        limit: 1,
      }),
    );
  });

  test('reports the latest succeeded dev run across projects', async () => {
    seedProjects({
      [PROJECT_A]: {devRun: {id: 'older-run', createdAt: '2026-09-01T10:00:00.000Z'}},
      [PROJECT_B]: {devRun: {id: 'newer-run', createdAt: '2026-09-02T10:00:00.000Z'}},
    });

    expect(await read({kind: 'workspace', workspaceId: WORKSPACE_ID})).toEqual({
      state: 'test_run_succeeded',
      testRunId: 'newer-run',
    });
  });

  test('is done at the first definition and reads no further project', async () => {
    seedProjects({[PROJECT_A]: {definitions: 1}, [PROJECT_B]: {}});

    expect(await read({kind: 'workspace', workspaceId: WORKSPACE_ID})).toEqual({state: 'done'});
    expect(api.listDefinitions).not.toHaveBeenCalledWith(
      expect.objectContaining({projectId: PROJECT_B}),
    );
  });

  test('walks every page of projects', async () => {
    seedProjects({[PROJECT_A]: {}, [PROJECT_B]: {definitions: 1}});
    api.listProjects
      .mockResolvedValueOnce({projects: [{id: PROJECT_A}], nextCursor: 'page-2'})
      .mockResolvedValueOnce({projects: [{id: PROJECT_B}], nextCursor: null});

    expect(await read({kind: 'workspace', workspaceId: WORKSPACE_ID})).toEqual({state: 'done'});
    expect(api.listProjects).toHaveBeenLastCalledWith(
      expect.objectContaining({workspaceId: WORKSPACE_ID, cursor: 'page-2'}),
    );
  });

  test("keeps a definition in project A out of project B's scope", async () => {
    seedProjects({[PROJECT_A]: {definitions: 1}, [PROJECT_B]: {}});

    expect(await read({kind: 'workspace', workspaceId: WORKSPACE_ID})).toEqual({state: 'done'});
    expect(await read({kind: 'project', projectId: PROJECT_B})).toEqual({state: 'open'});
  });

  test("keeps a dev run in project A out of project B's scope", async () => {
    seedProjects({
      [PROJECT_A]: {devRun: {id: 'run-a', createdAt: '2026-09-01T10:00:00.000Z'}},
      [PROJECT_B]: {},
    });

    expect(await read({kind: 'project', projectId: PROJECT_A})).toEqual({
      state: 'test_run_succeeded',
      testRunId: 'run-a',
    });
    expect(await read({kind: 'project', projectId: PROJECT_B})).toEqual({state: 'open'});
  });

  test('polls every 15 seconds until done', () => {
    const {refetchInterval} = firstWorkflowQueryOptions({
      kind: 'workspace',
      workspaceId: WORKSPACE_ID,
    });
    const intervalFor = (data: unknown) =>
      typeof refetchInterval === 'function'
        ? refetchInterval({state: {data}} as Parameters<typeof refetchInterval>[0])
        : refetchInterval;

    expect(intervalFor(undefined)).toBe(15_000);
    expect(intervalFor({state: 'open'})).toBe(15_000);
    expect(intervalFor({state: 'test_run_succeeded', testRunId: 'run-1'})).toBe(15_000);
    expect(intervalFor({state: 'done'})).toBe(false);
  });
});
