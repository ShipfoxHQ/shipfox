import {type AuthFixtures, authHelper} from '@shipfox/e2e-helper-auth';
import {type ProjectsFixtures, projectsHelper} from '@shipfox/e2e-helper-projects';
import {type WorkspacesFixtures, workspacesHelper} from '@shipfox/e2e-helper-workspaces';

export type AuthWorkspaceFixtures = AuthFixtures & WorkspacesFixtures;

export const authWorkspaceFixtures = {
  ...authHelper,
  ...workspacesHelper,
};

export type WorkspaceFixtures = AuthWorkspaceFixtures & ProjectsFixtures;

export const workspaceFixtures = {
  ...authWorkspaceFixtures,
  ...projectsHelper,
};
