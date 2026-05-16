import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type AuthFixtures, authHelper} from '@shipfox/e2e-helper-auth';
import {
  type IntegrationGithubFixtures,
  integrationGithubHelper,
} from '@shipfox/e2e-helper-integration-github';
import {type WorkspacesFixtures, workspacesHelper} from '@shipfox/e2e-helper-workspaces';

type Fixtures = AuthFixtures & WorkspacesFixtures & IntegrationGithubFixtures;

export const test = base.extend<Fixtures>({
  ...authHelper,
  ...workspacesHelper,
  ...integrationGithubHelper,
});

export {expect};
