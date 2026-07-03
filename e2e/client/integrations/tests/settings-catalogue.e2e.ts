import type {ListIntegrationProvidersResponseDto} from '@shipfox/api-integration-core-dto';
import {argosScreenshot, type Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const ADDED_DATE_RE = /^Added /u;

// The e2e API may enable a different provider set, so stub the list to keep the
// multi-tile grid deterministic. Typed against the real response DTO so a
// contract change fails `turbo type`; e2e packages depend on *-dto packages
// for types only because the runtime schema would load package dist, which
// self-references src under the test runner.
const CATALOGUE_PROVIDERS: ListIntegrationProvidersResponseDto = {
  providers: [
    {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
    {provider: 'sentry', display_name: 'Sentry', capabilities: []},
    {provider: 'gitea', display_name: 'Gitea', capabilities: ['source_control']},
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
  projects,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Integrations Settings Workspace',
  });
  await projects.createProject({workspaceId: workspace.id});
  await auth.loginAs(page, user);

  await stubProviders(page);

  await page.goto(`/workspaces/${workspace.id}/settings/integrations`);

  await expect(page.getByRole('heading', {name: 'Available integrations'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Install GitHub'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Install Sentry'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Install Gitea'})).toBeVisible();
  await expect(page.getByText('No integrations installed yet')).toBeVisible();

  await argosScreenshot(page, 'integrations/settings-empty');
});

test('settings catalogue shows an installed provider after Gitea install', async ({
  page,
  auth,
  gitea,
  projects,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Integrations Installed Workspace',
  });
  await projects.createProject({workspaceId: workspace.id});
  await auth.loginAs(page, user);

  const org = await gitea.createOrg();

  await page.goto(`/workspaces/${workspace.id}/integrations/gitea`);
  await page.getByLabel('Organization').fill(org.org);
  await page.getByRole('button', {name: 'Install'}).click();
  await expect(page.getByText('Gitea organization installed.')).toBeVisible();

  await page.goto(`/workspaces/${workspace.id}/settings/integrations`);

  const installed = page.locator('section[aria-label="Installed integrations"]');
  await expect(installed.getByText(`Gitea ${org.org}`, {exact: true})).toBeVisible();
  await expect(installed.getByText('Connected')).toHaveCount(0);
  await expect(installed.getByText(ADDED_DATE_RE)).toBeVisible();

  // `Added <date>` is server-generated, so it would drift the Argos baseline.
  // Pin only that text and keep the rest of the row anchored to the real Gitea
  // connection.
  await installed.getByText(ADDED_DATE_RE).evaluate((element) => {
    element.textContent = 'Added Jan 15, 2026';
  });

  await argosScreenshot(page, 'integrations/settings-installed');
});
