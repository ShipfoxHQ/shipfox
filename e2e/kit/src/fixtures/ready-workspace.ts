import type {Page} from '@shipfox/playwright';
import type {WorkspaceFixtures} from './workspace.js';

export interface ReadyWorkspace {
  userId: string;
  workspaceId: string;
  projectId: string;
  sessionToken: string;
}

export interface CreateReadyWorkspaceParams {
  name?: string;
}

export type CreateReadyWorkspace = (params?: CreateReadyWorkspaceParams) => Promise<ReadyWorkspace>;

export interface ReadyWorkspaceFixtures {
  createReadyWorkspace: CreateReadyWorkspace;
}

async function createReadyWorkspace(params: {
  fixtures: WorkspaceFixtures;
  page: Page;
  workspace: CreateReadyWorkspaceParams | undefined;
}): Promise<ReadyWorkspace> {
  const user = await params.fixtures.auth.createUser();
  const workspace = await params.fixtures.workspaces.create({
    userId: user.user.id,
    ...(params.workspace?.name === undefined ? {} : {name: params.workspace.name}),
  });
  const project = await params.fixtures.projects.createProject({workspaceId: workspace.id});
  const session = await params.fixtures.auth.createSession({user_id: user.user.id});
  await params.fixtures.auth.loginAs(params.page, user);

  return {
    userId: user.user.id,
    workspaceId: workspace.id,
    projectId: project.id,
    sessionToken: session.token,
  };
}

export const readyWorkspaceFixtures = {
  createReadyWorkspace: async (
    fixtures: WorkspaceFixtures & {page: Page},
    use: (create: CreateReadyWorkspace) => Promise<void>,
  ) => {
    await use((workspace) => createReadyWorkspace({fixtures, page: fixtures.page, workspace}));
  },
};
