import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type SecretsFixtures, secretsHelper} from '@shipfox/e2e-helper-secrets';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type SecretsScreenFixtures, secretsScreens} from '@shipfox/e2e-screens-secrets';

export const test = base.extend<WorkspaceFixtures & SecretsFixtures & SecretsScreenFixtures>({
  ...workspaceFixtures,
  ...secretsHelper,
  ...secretsScreens,
});
export {expect};
