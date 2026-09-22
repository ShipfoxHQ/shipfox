import {resolveWorkflowRunPermalink} from './workflow-run-permalink.js';

const RUN_ID = 'run-1';
const PROJECT_ID = 'project-1';
const WORKSPACE_ID = 'workspace-1';

const workspaces = [{id: WORKSPACE_ID, slug: 'acme'}];

function createReaders({
  overview = {projectId: PROJECT_ID},
  project = {workspaceId: WORKSPACE_ID, slug: 'payments'},
}: {
  overview?: {projectId: string} | null;
  project?: {workspaceId: string; slug: string} | null;
} = {}) {
  return {
    readRunOverview: vi.fn(async () => overview),
    readProject: vi.fn(async () => project),
  };
}

describe('resolveWorkflowRunPermalink', () => {
  test('resolves the project and workspace slugs in order', async () => {
    const readers = createReaders();

    const resolution = await resolveWorkflowRunPermalink({
      workflowRunId: RUN_ID,
      workspaces,
      ...readers,
    });

    expect(resolution).toEqual({
      kind: 'resolved',
      workspaceSlug: 'acme',
      projectSlug: 'payments',
    });
    expect(readers.readRunOverview).toHaveBeenCalledWith(RUN_ID);
    expect(readers.readProject).toHaveBeenCalledWith(PROJECT_ID);
  });

  test('returns not found when the run or project cannot be read', async () => {
    const missingRun = createReaders({overview: null});
    const missingProject = createReaders({project: null});

    await expect(
      resolveWorkflowRunPermalink({workflowRunId: RUN_ID, workspaces, ...missingRun}),
    ).resolves.toEqual({kind: 'not-found'});
    await expect(
      resolveWorkflowRunPermalink({workflowRunId: RUN_ID, workspaces, ...missingProject}),
    ).resolves.toEqual({kind: 'not-found'});
    expect(missingRun.readProject).not.toHaveBeenCalled();
  });

  test('returns no access when the project workspace is not in the session', async () => {
    const readers = createReaders({project: {workspaceId: 'other-workspace', slug: 'payments'}});

    await expect(
      resolveWorkflowRunPermalink({workflowRunId: RUN_ID, workspaces, ...readers}),
    ).resolves.toEqual({kind: 'no-access'});
  });
});
