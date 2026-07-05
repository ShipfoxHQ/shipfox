import {type AuthFixtures, authHelper} from '@shipfox/e2e-setup-auth';
import {type ProjectsFixtures, projectsHelper} from '@shipfox/e2e-setup-projects';
import {type WorkspacesFixtures, workspacesHelper} from '@shipfox/e2e-setup-workspaces';
import {type ReadyWorkspaceFixtures, readyWorkspaceFixtures} from './ready-workspace.js';

export type AuthWorkspaceFixtures = AuthFixtures & WorkspacesFixtures;

export const authWorkspaceFixtures = {
  ...authHelper,
  ...workspacesHelper,
};

export type WorkspaceFixtures = AuthWorkspaceFixtures & ProjectsFixtures & ReadyWorkspaceFixtures;

export const workspaceFixtures = {
  ...authWorkspaceFixtures,
  ...projectsHelper,
  ...readyWorkspaceFixtures,
};
