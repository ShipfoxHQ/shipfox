import {argosScreenshot, type Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const WORKSPACE_INTEGRATIONS_URL_RE = /\/workspaces\/[^/]+\/integrations\/?$/u;
const GITEA_INSTALL_URL_RE = /\/workspaces\/[^/]+\/integrations\/gitea\/?$/u;
const SETUP_NAVIGATION_TIMEOUT_MS = 15_000;
const PLATFORM_REPOSITORY = 'platform';

function projectsNewUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}/projects/new/?$`, 'u');
}

function modelProviderUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}/model-provider/?$`, 'u');
}

async function expectSetupNavigationHidden(page: Page): Promise<void> {
  await expect(page.getByRole('tab', {name: 'Projects'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Settings'})).toHaveCount(0);
  await expect(page.getByLabel('Switch project')).toHaveCount(0);
  await expect(page.getByLabel('Switch workspace')).toBeVisible();
}

async function captureAndSkipModelProviderSetup(page: Page, wid: string): Promise<void> {
  await expect(page).toHaveURL(modelProviderUrlRe(wid));
  await expect(page.getByRole('heading', {name: 'Configure model provider'})).toBeVisible();
  await expectSetupNavigationHidden(page);
  await argosScreenshot(page, 'integrations/model-provider-onboarding');
  await page.getByRole('button', {name: 'Skip for now'}).click();
}

test('connecting Gitea from onboarding flows into project creation', async ({
  page,
  auth,
  gitea,
}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  const org = await gitea.createOrg();
  await gitea.createRepo({org: org.org, name: PLATFORM_REPOSITORY});

  await page.goto('/');
  await page.getByLabel('Workspace name').fill('E2E Workspace');
  await page.getByRole('button', {name: 'Create workspace'}).click();
  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page.getByRole('heading', {name: 'Install source control'})).toBeVisible();
  await expectSetupNavigationHidden(page);

  const wid = new URL(page.url()).pathname.split('/')[2];
  expect(wid).toBeTruthy();

  await page.locator(`a[href$="/workspaces/${wid}/integrations/gitea"]`).click();
  await page.getByLabel('Organization').fill(org.org);
  await page.getByRole('button', {name: 'Install'}).click();

  await expect(page).toHaveURL(modelProviderUrlRe(wid as string), {
    timeout: SETUP_NAVIGATION_TIMEOUT_MS,
  });
  await expect(page).not.toHaveURL(GITEA_INSTALL_URL_RE);
  await expect(page).not.toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await captureAndSkipModelProviderSetup(page, wid as string);

  await expect(page).toHaveURL(projectsNewUrlRe(wid as string));
  await expectSetupNavigationHidden(page);

  await expect(page.getByRole('radio', {name: `${org.org}/${PLATFORM_REPOSITORY}`})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create project'})).toBeEnabled();
  await page.getByRole('button', {name: 'Create project'}).click();

  await expect(page.getByText('Project created.')).toBeVisible();
  await expect(page.getByRole('tab', {name: 'Runs'})).toBeVisible();
  await expect(page.getByLabel('Switch project')).toBeVisible();

  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await expect(page).toHaveURL(new RegExp(`/workspaces/${wid}/settings/integrations/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Installed integrations'})).toBeVisible();
});
