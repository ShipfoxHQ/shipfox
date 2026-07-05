import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type SecretsScreenFixtures, secretsScreens} from '@shipfox/e2e-screens-secrets';
import {type SecretsFixtures, secretsHelper} from '@shipfox/e2e-setup-secrets';

export const test = base.extend<WorkspaceFixtures & SecretsFixtures & SecretsScreenFixtures>({
  ...workspaceFixtures,
  ...secretsHelper,
  ...secretsScreens,
});
export {expect};
