import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

function githubConnectionFixture(workspaceId: string): IntegrationConnectionDto {
  return {
    id: '00000000-0000-4000-8000-0000000000ad',
    workspace_id: workspaceId,
    provider: 'github',
    external_account_id: 'github-org',
    slug: 'github_acme',
    display_name: 'GitHub Acme',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    external_url: 'https://github.com/acme',
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-15T12:00:00.000Z',
  };
}

async function stubCallback(page: Page, response: {status: number; body: unknown}): Promise<void> {
  await page.route('**/integrations/github/callback/api**', async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
}

test('GitHub request callback gives guests a terminal explanation', async ({
  githubCallback,
  page,
}) => {
  let callbackRequested = false;
  await page.route('**/integrations/github/callback/api**', async (route) => {
    callbackRequested = true;
    await route.abort();
  });

  await githubCallback.goto('setup_action=request');

  await expect(githubCallback.heading('You can return to your teammate')).toBeVisible();
  await expect(
    githubCallback.message('You do not need a Shipfox account just to approve GitHub access.'),
  ).toBeVisible();
  expect(callbackRequested).toBe(false);
  await stableScreenshot(page, 'integrations/github-callback-guest');
});

test('GitHub callback keeps malformed requests on member recovery', async ({
  auth,
  githubCallback,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  let callbackRequested = false;
  await page.route('**/integrations/github/callback/api**', async (route) => {
    callbackRequested = true;
    await route.abort();
  });

  await githubCallback.goto('setup_action=install&installation_id=42');

  await expect(githubCallback.heading('Invalid GitHub callback')).toBeVisible();
  await expect(githubCallback.openWorkspaceLink()).toBeVisible();
  expect(callbackRequested).toBe(false);
  await stableScreenshot(page, 'integrations/github-callback-invalid');
});

test('GitHub callback explains an actor mismatch', async ({
  auth,
  githubCallback,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  await stubCallback(page, {
    status: 403,
    body: {
      code: 'github-install-state-actor-mismatch',
      message: 'The callback belongs to another actor.',
    },
  });

  await githubCallback.goto('code=actor-code&installation_id=42&state=actor-state');

  await expect(githubCallback.heading('Use the account that started this install')).toBeVisible();
  await expect(githubCallback.openWorkspaceLink()).toBeVisible();
  await stableScreenshot(page, 'integrations/github-callback-actor-mismatch');
});

test('GitHub callback navigates to the API-confirmed workspace on direct success', async ({
  auth,
  githubCallback,
  integrationsCatalogue,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'GitHub Callback Workspace',
  });
  await auth.loginAs(page, user);
  await stubCallback(page, {status: 200, body: githubConnectionFixture(workspace.id)});

  await githubCallback.goto('code=grant-code&installation_id=42&state=signed-state');

  await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'));
  await expect(page.getByText('GitHub installed.')).toBeVisible();
  await expect(integrationsCatalogue.emptyInstalledState()).toBeVisible();
  await stableScreenshot(page, 'integrations/github-callback-success');
});
