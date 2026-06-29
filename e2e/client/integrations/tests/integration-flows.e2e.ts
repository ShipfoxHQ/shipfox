import {randomUUID} from 'node:crypto';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const WORKSPACE_INTEGRATIONS_URL_RE = /\/workspaces\/[^/]+\/integrations\/?$/u;
const DEBUG_INSTALL_URL_RE = /\/workspaces\/[^/]+\/integrations\/debug\/?$/u;
const DEBUG_REPOSITORY_RE = /debug-owner\/platform/u;

function projectsNewUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}/projects/new/?$`, 'u');
}

function agentProviderUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}/agent-provider/?$`, 'u');
}

function setupDestinationUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}/(agent-provider|projects/new)/?$`, 'u');
}

async function expectSetupNavigationHidden(page: Page): Promise<void> {
  await expect(page.getByRole('tab', {name: 'Projects'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Settings'})).toHaveCount(0);
  await expect(page.getByLabel('Switch project')).toHaveCount(0);
  await expect(page.getByLabel('Switch workspace')).toBeVisible();
}

async function skipAgentProviderSetupIfShown(page: Page, wid: string): Promise<void> {
  await expect(page).toHaveURL(setupDestinationUrlRe(wid));

  if (!agentProviderUrlRe(wid).test(page.url())) return;

  await expect(page.getByRole('heading', {name: 'Configure agent provider'})).toBeVisible();
  await expectSetupNavigationHidden(page);
  await page.getByRole('button', {name: 'Skip for now'}).click();
}

test('connecting Debug from onboarding flows into project creation', async ({page, auth}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  // Reproduces the user-reported flow: a fresh user lands on Install source
  // control via the onboarding handoff (so WorkspaceSetupGuard has already
  // populated the projects + source-connections caches with empty data for this
  // workspace), then clicks Debug to create their first connection.
  await page.goto('/');
  await page.getByLabel('Workspace name').fill(`E2E Workspace ${randomUUID()}`);
  await page.getByRole('button', {name: 'Create workspace'}).click();
  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page.getByRole('heading', {name: 'Install source control'})).toBeVisible();
  await expectSetupNavigationHidden(page);

  const wid = new URL(page.url()).pathname.split('/')[2];
  expect(wid).toBeTruthy();

  await page.locator(`a[href$="/workspaces/${wid}/integrations/debug"]`).click();

  // DebugInstallPage creates the connection on mount, fires the success toast,
  // then navigates back to /workspaces/$wid. The setup guard should see the new
  // connection plus zero projects and forward the user through provider setup.
  await expect(page.getByText('Debug source control connected.')).toBeVisible();
  await expect(page).not.toHaveURL(DEBUG_INSTALL_URL_RE);
  await expect(page).not.toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await skipAgentProviderSetupIfShown(page, wid as string);

  await expect(page).toHaveURL(projectsNewUrlRe(wid as string));
  await expectSetupNavigationHidden(page);

  await expect(page.getByRole('radio', {name: DEBUG_REPOSITORY_RE})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create project'})).toBeEnabled();
  await page.getByRole('button', {name: 'Create project'}).click();

  await expect(page.getByText('Project created.')).toBeVisible();
  await expect(page.getByRole('tab', {name: 'Runs'})).toBeVisible();
  await expect(page.getByLabel('Switch project')).toBeVisible();

  await page.goto(`/workspaces/${wid}/integrations`);

  await expect(page).toHaveURL(new RegExp(`/workspaces/${wid}/settings/integrations/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Installed integrations'})).toBeVisible();
});
