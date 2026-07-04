import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const WORKSPACE_INTEGRATIONS_URL_RE = /\/workspaces\/[^/]+\/integrations\/?$/u;
const GITEA_INSTALL_URL_RE = /\/workspaces\/[^/]+\/integrations\/gitea\/?$/u;
const SETUP_NAVIGATION_TIMEOUT_MS = 15_000;

function modelProviderUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}/model-provider/?$`, 'u');
}

async function expectSetupNavigationHidden(page: Page): Promise<void> {
  await expect(page.getByRole('tab', {name: 'Projects'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Settings'})).toHaveCount(0);
  await expect(page.getByLabel('Switch project')).toHaveCount(0);
  await expect(page.getByLabel('Switch workspace')).toBeVisible();
}

async function expectModelProviderSetup(page: Page, wid: string): Promise<void> {
  await expect(page).toHaveURL(modelProviderUrlRe(wid));
  await expect(page.getByRole('heading', {name: 'Configure model provider'})).toBeVisible();
  await expectSetupNavigationHidden(page);
}

test('connecting Gitea from source-control setup opens model-provider setup', async ({
  page,
  auth,
  gitea,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id, name: 'E2E Workspace'});
  await auth.loginAs(page, user);

  const org = await gitea.createOrg();

  await page.goto('/');
  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}/integrations/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Install source control'})).toBeVisible();
  await expectSetupNavigationHidden(page);

  await page.locator(`a[href$="/workspaces/${workspace.id}/integrations/gitea"]`).click();
  await page.getByLabel('Organization').fill(org.org);
  await page.getByRole('button', {name: 'Install'}).click();

  await expect(page).toHaveURL(modelProviderUrlRe(workspace.id), {
    timeout: SETUP_NAVIGATION_TIMEOUT_MS,
  });
  await expect(page).not.toHaveURL(GITEA_INSTALL_URL_RE);
  await expect(page).not.toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expectModelProviderSetup(page, workspace.id);
});
