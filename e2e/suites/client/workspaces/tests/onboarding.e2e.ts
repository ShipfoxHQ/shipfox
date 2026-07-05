import {randomUUID} from 'node:crypto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {expect, test} from './test.js';
import {
  ONBOARDING_URL_RE,
  SETUP_NAVIGATION_TIMEOUT_MS,
  WORKSPACE_INTEGRATIONS_URL_RE,
} from './workspace-urls.js';

test.describe('workspace onboarding', () => {
  test('redirects a no-workspace user from / to onboarding', async ({
    auth,
    page,
    workspaceOnboarding,
  }) => {
    const user = await auth.createUser();
    await auth.loginAs(page, user);

    await workspaceOnboarding.gotoRoot();

    await expect(page).toHaveURL(ONBOARDING_URL_RE);
    await expect(workspaceOnboarding.heading()).toBeVisible();
    await expect(workspaceOnboarding.workspaceNameField()).toBeVisible();
    await stableScreenshot(page, 'workspaces/onboarding-blank');
  });

  test('redirects a no-workspace user from a workspace deep-link to onboarding', async ({
    auth,
    page,
    workspaceOnboarding,
  }) => {
    const user = await auth.createUser();
    await auth.loginAs(page, user);

    await workspaceOnboarding.gotoWorkspace(randomUUID());

    await expect(page).toHaveURL(ONBOARDING_URL_RE);
    await expect(workspaceOnboarding.heading()).toBeVisible();
  });

  test('creates the first workspace via onboarding and persists lastWorkspaceId', async ({
    auth,
    page,
    setupShell,
    workspaceHome,
    workspaceOnboarding,
  }) => {
    const user = await auth.createUser();
    await auth.loginAs(page, user);
    const workspaceName = 'E2E Onboarding Workspace';

    await workspaceOnboarding.gotoRoot();
    await expect(page).toHaveURL(ONBOARDING_URL_RE);
    await workspaceOnboarding.createWorkspace(workspaceName);

    await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
    await expect(setupShell.sourceControlHeading()).toBeVisible({
      timeout: SETUP_NAVIGATION_TIMEOUT_MS,
    });
    await setupShell.expectNavigationHidden();
    const workspaceId = workspaceHome.currentWorkspaceId();
    expect(workspaceId).toBeTruthy();
    expect(await workspaceHome.readLastWorkspaceId()).toBe(workspaceId);
    await stableScreenshot(page, 'workspaces/onboarding-complete');
  });
});
