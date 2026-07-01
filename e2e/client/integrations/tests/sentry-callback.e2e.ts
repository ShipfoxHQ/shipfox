import type {SentryConnectResponseDto} from '@shipfox/api-integration-sentry-dto';
import {argosScreenshot, type Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const CALLBACK_URL =
  '/integrations/sentry/callback?code=test-code&installation_id=test-install&org_slug=acme';

// Typed against the real connect response DTO so a contract change fails
// `turbo type` instead of letting the stub pass on a stale shape (e2e packages
// import *-dto packages for types only — see settings-catalogue.e2e.ts).
function sentryConnectionFixture(workspaceId: string): SentryConnectResponseDto {
  return {
    id: '00000000-0000-4000-8000-0000000000ab',
    workspace_id: workspaceId,
    provider: 'sentry',
    external_account_id: 'acme',
    slug: 'sentry_acme',
    display_name: 'Sentry acme',
    lifecycle_status: 'active',
    capabilities: [],
    external_url: 'https://acme.sentry.io/',
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-15T12:00:00.000Z',
  };
}

async function stubConnect(page: Page, response: {status: number; body: unknown}): Promise<void> {
  await page.route('**/integrations/sentry/connect', async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
}

async function stubProjectExists(page: Page, workspaceId: string): Promise<void> {
  await page.route('**/projects?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('workspace_id') !== workspaceId) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projects: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            workspace_id: workspaceId,
            name: 'Platform',
            source: {
              connection_id: '00000000-0000-4000-8000-000000000002',
              external_repository_id: 'debug:platform',
            },
            created_at: '2026-01-15T12:00:00.000Z',
            updated_at: '2026-01-15T12:00:00.000Z',
          },
        ],
        next_cursor: null,
      }),
    });
  });
}

test('Sentry callback shows an error when required params are missing', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);

  await page.goto('/integrations/sentry/callback');

  await expect(
    page.getByText(
      'This Sentry link is missing required parameters. Start the install again from your workspace settings.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', {name: 'Back to Shipfox'})).toBeVisible();

  await argosScreenshot(page, 'integrations/sentry-callback-missing-params');
});

test('Sentry callback shows the workspace picker', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: 'Sentry Picker Workspace'});
  await auth.loginAs(page, user);

  await page.goto(CALLBACK_URL);

  await expect(page.getByRole('heading', {name: 'Install Sentry'})).toBeVisible();
  await expect(page.getByText('Install the Sentry org "acme" in a workspace.')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Install'})).toBeVisible();

  await argosScreenshot(page, 'integrations/sentry-callback-pick-workspace');
});

test('Sentry callback installs to a workspace on success', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Sentry Install Workspace',
  });
  await auth.loginAs(page, user);

  await stubConnect(page, {status: 200, body: sentryConnectionFixture(workspace.id)});
  await stubProjectExists(page, workspace.id);

  await page.goto(CALLBACK_URL);
  await expect(page.getByRole('heading', {name: 'Install Sentry'})).toBeVisible();
  await page.getByRole('button', {name: 'Install'}).click();

  // The stub never persisted a connection, so we assert only the success toast
  // and the redirect target — not that Sentry appears in the gallery.
  await expect(page.getByText('Sentry installed.')).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${workspace.id}/settings/integrations/?$`, 'u'),
  );
});

test('Sentry callback offers Start over on a terminal failure', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: 'Sentry Terminal Workspace'});
  await auth.loginAs(page, user);

  // A spent grant code returns a 4xx with no recovery except a fresh install,
  // so classifySentryConnectError yields a terminal failure with startOver.
  await stubConnect(page, {
    status: 400,
    body: {
      message: 'This Sentry link could not be completed. Start the install again.',
      code: 'access-denied',
    },
  });

  await page.goto(
    '/integrations/sentry/callback?code=spent-code&installation_id=test-install&org_slug=acme',
  );
  await page.getByRole('button', {name: 'Install'}).click();

  await expect(
    page.getByText('This Sentry link could not be completed. Start the install again.'),
  ).toBeVisible();
  await expect(page.getByRole('link', {name: 'Start over'})).toBeVisible();

  await argosScreenshot(page, 'integrations/sentry-callback-terminal');
});

test('Sentry callback offers Retry on a retryable failure', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: 'Sentry Retry Workspace'});
  await auth.loginAs(page, user);

  // A rate-limit (no retry-after window) classifies as retryable, so the Retry
  // button stays enabled.
  await stubConnect(page, {
    status: 429,
    body: {message: 'Sentry is rate limiting requests.', code: 'rate-limited'},
  });

  await page.goto(CALLBACK_URL);
  await page.getByRole('button', {name: 'Install'}).click();

  await expect(
    page.getByText('Sentry is rate limiting requests. Try again in a moment.'),
  ).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry'})).toBeVisible();

  await argosScreenshot(page, 'integrations/sentry-callback-retryable');
});
