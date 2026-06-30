import {argosScreenshot, type Page} from '@shipfox/playwright';
import {createShipfoxTokenPrefixRegexes} from '@shipfox/regex';
import {expect, test} from './test.js';

const RUNNER_TOKEN_PREFIX_RE = createShipfoxTokenPrefixRegexes(['mrt']).unqualified;
const VISUAL_TEST_NOW = new Date('2026-01-15T12:00:00Z');
const VISUAL_TEST_RUNNER_TOKEN_PREFIX = 'sf_mrt_visual';
const VISUAL_TEST_RUNNER_TOKEN = 'sf_mrt_visual_regression_token';
const VISUAL_TEST_CREATED_AT = 'Jan 15, 2026, 12:00 PM';
const VISUAL_TEST_EXPIRES_AT = 'Jan 16, 2026, 12:00 PM';

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

test('manages workspace manual registration tokens from settings', async ({
  page,
  auth,
  workspaces,
}) => {
  await page.clock.setFixedTime(VISUAL_TEST_NOW);

  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Runner Settings Workspace',
  });
  await auth.loginAs(page, user);
  await stubProjectExists(page, workspace.id);

  await page.goto(`/workspaces/${workspace.id}/settings/runners`);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}/settings/runners/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Workspace settings'})).toBeVisible();
  await expect(page.getByText('No usable manual registration tokens')).toBeVisible();
  await argosScreenshot(page, 'runners/settings-runners-empty');

  await page.getByRole('button', {name: 'Create token'}).click();
  const createTokenDialog = page.getByRole('dialog', {name: 'Create manual registration token'});
  await expect(createTokenDialog).toBeVisible();
  await expect(page.getByLabel('Token name')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create token'}).last()).toBeVisible();
  await argosScreenshot(page, 'runners/settings-runners-create-token-form');

  await page.getByLabel('Token name').fill('E2E runner');
  await page.getByRole('button', {name: 'Create token'}).last().click();

  await expect(page.getByText('Token created')).toBeVisible();
  const rawToken = createTokenDialog
    .locator('p.font-code')
    .filter({hasText: RUNNER_TOKEN_PREFIX_RE});
  await expect(rawToken).toBeVisible();
  await rawToken.evaluate((element: Element, token) => {
    element.textContent = token;
  }, VISUAL_TEST_RUNNER_TOKEN);
  await expect(createTokenDialog.getByText(VISUAL_TEST_RUNNER_TOKEN)).toBeVisible();

  const manualRegistrationTokenRow = page.locator('tr', {hasText: 'E2E runner'});
  await expect(manualRegistrationTokenRow).toBeVisible();
  const manualRegistrationTokenCells = manualRegistrationTokenRow.locator('td');
  await manualRegistrationTokenCells.nth(1).evaluate((element: Element, prefix) => {
    element.textContent = prefix;
  }, VISUAL_TEST_RUNNER_TOKEN_PREFIX);
  await manualRegistrationTokenCells.nth(2).evaluate((element: Element, expiresAt) => {
    element.textContent = expiresAt;
  }, VISUAL_TEST_EXPIRES_AT);
  await manualRegistrationTokenCells.nth(3).evaluate((element: Element, createdAt) => {
    element.textContent = createdAt;
  }, VISUAL_TEST_CREATED_AT);
  await argosScreenshot(page, 'runners/settings-runners-create-token-success');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Revoke E2E runner'})).toBeVisible();

  await page.getByRole('button', {name: 'Revoke E2E runner'}).click();
  await page.getByRole('button', {name: 'Revoke', exact: true}).last().click();

  await expect(page.getByRole('button', {name: 'Revoke E2E runner'})).toHaveCount(0);
  await expect(page.getByText('No usable manual registration tokens')).toBeVisible();
});
