import {randomUUID} from 'node:crypto';
import {expect, test} from './test.js';

const WORKSPACE_INTEGRATIONS_URL_RE = /\/workspaces\/[^/]+\/integrations\/?$/u;
const DEBUG_INSTALL_URL_RE = /\/workspaces\/[^/]+\/integrations\/debug\/?$/u;

function projectsNewUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}/projects/new/?$`, 'u');
}

test('connecting Debug from onboarding flows into project creation', async ({page, auth}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  // Reproduces the user-reported flow: a fresh user lands on Connect source
  // control via the onboarding handoff (so HomeRouter has already populated
  // the projects + source-connections caches with empty data for this
  // workspace), then clicks Debug to create their first connection.
  await page.goto('/');
  await page.getByLabel('Workspace name').fill(`E2E Workspace ${randomUUID()}`);
  await page.getByRole('button', {name: 'Create workspace'}).click();
  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page.getByRole('heading', {name: 'Connect source control'})).toBeVisible();

  const wid = new URL(page.url()).pathname.split('/')[2];
  expect(wid).toBeTruthy();

  await page.locator(`a[href$="/workspaces/${wid}/integrations/debug"]`).click();

  // DebugInstallPage creates the connection on mount, fires the success toast,
  // then navigates back to /workspaces/$wid — HomeRouter should see the new
  // connection plus zero projects and forward the user to /projects/new.
  await expect(page.getByText('Debug source control connected.')).toBeVisible();
  await expect(page).not.toHaveURL(DEBUG_INSTALL_URL_RE);
  await expect(page).not.toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page).toHaveURL(projectsNewUrlRe(wid as string));
});
