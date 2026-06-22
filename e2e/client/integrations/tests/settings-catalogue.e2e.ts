import type {ListIntegrationProvidersResponseDto} from '@shipfox/api-integration-core-dto';
import {argosScreenshot, type Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const ADDED_DATE_RE = /^Added /u;

// The e2e API may only enable Debug. Stub the providers list so the multi-tile
// grid renders deterministically and the screenshot guards the GitHub/Sentry
// tiles regardless of provider config. Typed against the real response DTO so a
// contract change fails `turbo type` — e2e packages depend on *-dto packages
// for types only (the runtime schema would load the package's dist, which
// self-references src and is not loadable under the test runner).
const CATALOGUE_PROVIDERS: ListIntegrationProvidersResponseDto = {
  providers: [
    {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
    {provider: 'sentry', display_name: 'Sentry', capabilities: []},
    {provider: 'debug', display_name: 'Debug', capabilities: ['source_control']},
  ],
};

async function stubProviders(page: Page): Promise<void> {
  await page.route('**/integration-providers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CATALOGUE_PROVIDERS),
    });
  });
}

test('settings catalogue lists available providers with an empty installed state', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Integrations Settings Workspace',
  });
  await auth.loginAs(page, user);

  // Register the providers stub before navigating: the gallery fires its
  // queries on mount.
  await stubProviders(page);

  await page.goto(`/workspaces/${workspace.id}/settings/integrations`);

  await expect(page.getByRole('heading', {name: 'Available integrations'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Connect GitHub'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Connect Sentry'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Connect Debug'})).toBeVisible();
  await expect(page.getByText('No integrations connected yet')).toBeVisible();

  await argosScreenshot(page, 'integrations/settings-empty');
});

test('settings catalogue shows a connected provider after Debug connect', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Integrations Installed Workspace',
  });
  await auth.loginAs(page, user);

  // Real Debug connect (no external dependency): the install page creates the
  // connection on mount, fires the success toast, then forwards to
  // /workspaces/$wid, so we explicitly return to settings to inspect the row.
  await page.goto(`/workspaces/${workspace.id}/integrations/debug`);
  await expect(page.getByText('Debug source control connected.')).toBeVisible();

  await page.goto(`/workspaces/${workspace.id}/settings/integrations`);

  const installed = page.locator('section[aria-label="Installed integrations"]');
  await expect(installed.getByText('Debug', {exact: true})).toBeVisible();
  await expect(installed.getByText('Connected')).toBeVisible();

  // `Added <date>` is server-generated, so it would drift the Argos baseline
  // every day. Pin it to a fixed string before the snapshot, keeping the row
  // anchored to the real Debug connection otherwise.
  await installed.getByText(ADDED_DATE_RE).evaluate((element) => {
    element.textContent = 'Added Jan 15, 2026';
  });

  await argosScreenshot(page, 'integrations/settings-installed');
});
