import {randomUUID} from 'node:crypto';
import {createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {
  createChecklistWorkspace,
  createFirstDefinition,
  INITIAL_CHECKLIST_COUNT_RE,
  LINEAR_AUTHORIZE_ORIGIN,
  LINEAR_AUTHORIZE_URL_RE,
  LINEAR_CHECKLIST_COUNT_RE,
  SKIPPED_TOOLS_CHECKLIST_COUNT_RE,
  stubLinearAuthorizePage,
  stubLinearCallback,
} from './setup-checklist-fixtures.js';
import {expect, test} from './test.js';

// The first-workflow read polls every 15 seconds while the tab is visible.
const FIRST_WORKFLOW_POLL_TIMEOUT_MS = 30_000;

function workspaceHomeUrlRe(workspaceSlug: string): RegExp {
  return new RegExp(`/w/${workspaceSlug}/?$`, 'u');
}

test.describe('workspace setup checklist', () => {
  test('connects Linear from the tools step and returns to the home', async ({
    auth,
    page,
    projects,
    workspaceHome,
    workspaceSetupChecklist,
    workspaces,
  }) => {
    const workspace = await createChecklistWorkspace({
      auth,
      page,
      projects,
      workspaces,
      name: 'Setup Guide Workspace',
    });
    await stubLinearAuthorizePage(page);
    await stubLinearCallback(page, workspace.id);

    await workspaceHome.goto(workspace.slug);
    await expect(workspaceSetupChecklist.toolsPanel()).toBeVisible();
    await expect(workspaceSetupChecklist.skipToolsButton()).toBeVisible();
    await expect(workspaceSetupChecklist.panel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toHaveAttribute(
      'aria-label',
      INITIAL_CHECKLIST_COUNT_RE,
    );

    await test.step('leave for Linear from the home grid', async () => {
      await workspaceSetupChecklist.toolsInstallLink('Linear').click();
      // The install page leaves the app through window.location.assign, so wait
      // for the stubbed authorize document to commit. Reading the URL from the
      // route handler instead leaves that navigation in flight, and it then
      // lands on top of the callback navigation the next step starts.
      await page.waitForURL(LINEAR_AUTHORIZE_URL_RE);
      const authorizeUrl = new URL(page.url());
      expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
        `${LINEAR_AUTHORIZE_ORIGIN}/oauth/authorize`,
      );
    });

    await test.step('return through the Linear callback to the home', async () => {
      const linearOrganizationId = `linear-e2e-org-${randomUUID()}`;
      await createLinearConnection({
        workspaceId: workspace.id,
        organizationId: linearOrganizationId,
        organizationUrlKey: `linear-e2e-${linearOrganizationId}`,
        appUserId: `linear-e2e-app-user-${linearOrganizationId}`,
        displayName: 'Linear E2E',
        accessToken: `linear-e2e-token-${linearOrganizationId}`,
      });
      const linearCallbackResponse = page.waitForResponse('**/integrations/linear/callback/api**');
      await page.goto('/integrations/linear/callback?code=e2e-code&state=e2e-state', {
        waitUntil: 'commit',
      });
      expect((await linearCallbackResponse).ok()).toBe(true);
      await expect(page).toHaveURL(workspaceHomeUrlRe(workspace.slug));
    });

    await expect(workspaceSetupChecklist.toolsConnectedCell('Linear')).toBeVisible();
    await expect(workspaceSetupChecklist.continueButton()).toBeVisible();
    await expect(workspaceSetupChecklist.skipToolsButton()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toHaveAttribute(
      'aria-label',
      LINEAR_CHECKLIST_COUNT_RE,
    );
    await expect(workspaceSetupChecklist.status()).toHaveAttribute('aria-live', 'polite');
    await expect(workspaceSetupChecklist.status()).toHaveText(LINEAR_CHECKLIST_COUNT_RE);

    // This installation has no runners, so the next panel is the checklist.
    await workspaceSetupChecklist.continueButton().click();
    await expect(workspaceSetupChecklist.toolsPanel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.text('Set up runner capacity')).toBeVisible();
  });

  test('restores the setup guide after a dismissal', async ({
    auth,
    page,
    projects,
    workspaceHome,
    workspaceSetupChecklist,
    workspaces,
  }) => {
    const workspace = await createChecklistWorkspace({
      auth,
      page,
      projects,
      workspaces,
      name: 'Dismissed Guide Workspace',
    });

    await workspaceHome.goto(workspace.slug);
    await expect(workspaceSetupChecklist.toolsPanel()).toBeVisible();

    await workspaceSetupChecklist.hideButton().click();
    await expect(workspaceSetupChecklist.toolsPanel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toHaveCount(0);

    await workspaceHome.gotoSettingsGeneral();
    await expect(workspaceHome.showSetupGuideButton()).toBeVisible();
    await workspaceHome.showSetupGuideButton().click();
    await expect(workspaceHome.showSetupGuideButton()).toHaveCount(0);

    await workspaceHome.goto(workspace.slug);
    await expect(workspaceSetupChecklist.toolsPanel()).toBeVisible();
  });

  test('opens and closes the setup guide with the keyboard', async ({
    auth,
    page,
    projects,
    workspaceHome,
    workspaceSetupChecklist,
    workspaces,
  }) => {
    const workspace = await createChecklistWorkspace({
      auth,
      page,
      projects,
      workspaces,
      name: 'Keyboard Guide Workspace',
    });

    await workspaceHome.goto(workspace.slug);
    await expect(workspaceSetupChecklist.indicator()).toBeVisible();

    await workspaceSetupChecklist.indicator().focus();
    await page.keyboard.press('Enter');
    await expect(workspaceSetupChecklist.dialog()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(workspaceSetupChecklist.dialog()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toBeFocused();
  });

  test('completes the checklist after skipping the tools step', async ({
    auth,
    page,
    projects,
    workspaceHome,
    workspaceSetupChecklist,
    workspaces,
  }) => {
    const workspace = await createChecklistWorkspace({
      auth,
      page,
      projects,
      workspaces,
      name: 'Cloud Setup Guide Workspace',
      installationRunners: 'managed',
    });

    await workspaceHome.goto(workspace.slug);
    await workspaceSetupChecklist.skipToolsButton().click();

    await expect(workspaceSetupChecklist.firstWorkflowPanel()).toBeVisible();
    await expect(workspaceSetupChecklist.toolsPanel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toHaveAttribute(
      'aria-label',
      SKIPPED_TOOLS_CHECKLIST_COUNT_RE,
    );

    // The skipped tools row no longer counts, so the first definition is the
    // transition that completes the checklist.
    await createFirstDefinition({auth, workspace});
    await expect(workspaceSetupChecklist.status()).toHaveText("You're set up", {
      timeout: FIRST_WORKFLOW_POLL_TIMEOUT_MS,
    });
    await workspaceSetupChecklist.indicator().click();
    await expect(workspaceSetupChecklist.completionMessage()).toBeVisible();
    await workspaceSetupChecklist.doneButton().click();
    await expect(workspaceSetupChecklist.firstWorkflowPanel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toHaveCount(0);
  });
});
