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

const GITHUB_API_CALL = /\/integrations\/github\/(callback\/api|link)/u;
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize?state=link-state';

// The support route shares its path with the link API, so only POSTs are API calls.
async function stubLinkStart(page: Page): Promise<{
  navigated: Promise<string>;
  requestedWorkspaces: string[];
}> {
  const requestedWorkspaces: string[] = [];
  let resolveNavigation!: (url: string) => void;
  const navigated = new Promise<string>((resolve) => {
    resolveNavigation = resolve;
  });
  await page.route('https://github.com/**', async (route) => {
    resolveNavigation(route.request().url());
    await route.abort();
  });
  await page.route('**/integrations/github/link', async (route) => {
    if (route.request().method() !== 'POST') return await route.fallback();
    requestedWorkspaces.push(route.request().postDataJSON().workspace_id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({authorize_url: GITHUB_AUTHORIZE_URL}),
    });
  });
  return {navigated, requestedWorkspaces};
}

async function stubLinkComplete(
  page: Page,
  response: {status: number; body: unknown},
): Promise<void> {
  await page.route('**/integrations/github/link/complete', async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
}

async function trackApiCalls(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route(GITHUB_API_CALL, async (route) => {
    if (route.request().method() !== 'POST') return await route.fallback();
    calls.push(route.request().url());
    await route.abort();
  });
  return calls;
}

test('GitHub request callback gives guests a terminal explanation', async ({
  githubCallback,
  page,
}) => {
  const apiCalls = await trackApiCalls(page);

  await githubCallback.goto('setup_action=request');

  await expect(githubCallback.heading('GitHub request approved')).toBeVisible();
  await expect(githubCallback.message('They can now continue setup in Shipfox.')).toBeVisible();
  await expect(githubCallback.goToShipfoxLink()).toHaveAttribute('href', '/');
  expect(apiCalls).toEqual([]);
  await stableScreenshot(page, 'integrations/github-callback-guest');
});

test('GitHub callback keeps malformed requests on Shipfox recovery with several workspaces', async ({
  auth,
  githubCallback,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: 'First Workspace'});
  await workspaces.create({userId: user.user.id, name: 'Second Workspace'});
  await auth.loginAs(page, user);
  const apiCalls = await trackApiCalls(page);

  await githubCallback.goto('setup_action=install&installation_id=42');

  await expect(githubCallback.heading('Invalid GitHub callback')).toBeVisible();
  await expect(
    githubCallback.message(
      'This link is missing required callback information. Go to Shipfox to start the installation again.',
    ),
  ).toBeVisible();
  await expect(githubCallback.goToShipfoxLink()).toHaveAttribute('href', '/');
  expect(apiCalls).toEqual([]);
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

  await expect(githubCallback.heading('This GitHub connection cannot be completed')).toBeVisible();
  await expect(
    githubCallback.message('It was started with a different Shipfox account.'),
  ).toBeVisible();
  await expect(githubCallback.goToShipfoxLink()).toHaveAttribute('href', '/');
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
  await expect(githubCallback.message('GitHub installed.')).toBeVisible();
  await expect(integrationsCatalogue.emptyInstalledState()).toBeVisible();
  await stableScreenshot(page, 'integrations/github-callback-success');
});

test('GitHub callback recovers an orphaned installation from a missing state', async ({
  auth,
  githubCallback,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  const link = await stubLinkStart(page);

  await githubCallback.goto('setup_action=install&installation_id=42&code=orphan-code');

  expect(await link.navigated).toBe(GITHUB_AUTHORIZE_URL);
  expect(link.requestedWorkspaces).toEqual([workspace.id]);
});

test('The support route starts the GitHub link flow for its workspace', async ({
  auth,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  const link = await stubLinkStart(page);

  await page.goto(`/w/${workspace.slug}/integrations/github/link`);

  expect(await link.navigated).toBe(GITHUB_AUTHORIZE_URL);
  expect(link.requestedWorkspaces).toEqual([workspace.id]);
});

test('GitHub link callback connects the installation and opens the workspace', async ({
  auth,
  githubCallback,
  integrationsCatalogue,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  await stubLinkComplete(page, {status: 200, body: githubConnectionFixture(workspace.id)});

  await githubCallback.goto('code=link-code&state=link-state');

  await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'));
  await expect(githubCallback.message('GitHub installed.')).toBeVisible();
  await expect(integrationsCatalogue.emptyInstalledState()).toBeVisible();
});

test('GitHub link callback explains when no installation can be linked', async ({
  auth,
  githubCallback,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  await stubLinkComplete(page, {
    status: 409,
    body: {
      code: 'github-no-linkable-installation',
      message: 'No linkable GitHub installation was found',
      details: {accessible: 0, linked_elsewhere: 0},
    },
  });

  await githubCallback.goto('code=none-code&state=none-state');

  await expect(githubCallback.heading('No GitHub installation to connect')).toBeVisible();
  await expect(
    githubCallback.message('Shipfox is not installed on any GitHub account you can access.'),
  ).toBeVisible();
  await expect(githubCallback.message('SAML single sign-on')).toBeVisible();
  await expect(githubCallback.goToShipfoxLink()).toHaveAttribute('href', '/');
});

test('GitHub link callback lets the user pick among several installations', async ({
  auth,
  githubCallback,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  await stubLinkComplete(page, {
    status: 200,
    body: {
      candidates: [
        {
          installation_id: 101,
          account_login: 'acme',
          account_type: 'Organization',
          repository_selection: 'all',
        },
        {
          installation_id: 202,
          account_login: 'octocat',
          account_type: 'User',
          repository_selection: 'selected',
        },
      ],
      selection_token: 'selection-token',
    },
  });
  const selections: unknown[] = [];
  await page.route('**/integrations/github/link/select', async (route) => {
    selections.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(githubConnectionFixture(workspace.id)),
    });
  });

  await githubCallback.goto('code=pick-code&state=pick-state');

  await expect(githubCallback.heading('Choose a GitHub account')).toBeVisible();
  await expect(githubCallback.message('Personal account')).toBeVisible();
  await stableScreenshot(page, 'integrations/github-callback-installation-picker');
  await githubCallback.connectAccountButton('acme').click();

  await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'));
  expect(selections).toEqual([{selection_token: 'selection-token', installation_id: 101}]);
});

test('GitHub link callback sends users with too many installations to support', async ({
  auth,
  githubCallback,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  await stubLinkComplete(page, {
    status: 409,
    body: {
      code: 'github-too-many-linkable-installations',
      message: 'Too many linkable GitHub installations were found to choose from',
      details: {count: 21},
    },
  });

  await githubCallback.goto('code=many-code&state=many-state');

  await expect(githubCallback.heading('Too many GitHub installations found')).toBeVisible();
  await expect(githubCallback.message('Contact support')).toBeVisible();
});
