import {argosScreenshot} from '@shipfox/playwright';
import {createShipfoxTokenPrefixRegexes} from '@shipfox/regex';
import {expect, test} from './test.js';

const REGISTRATION_TOKEN_PREFIX_RE = createShipfoxTokenPrefixRegexes(['mrt']).unqualified;
const VISUAL_TEST_NOW = new Date('2026-01-15T12:00:00Z');
const VISUAL_TEST_REGISTRATION_TOKEN_PREFIX = 'sf_mrt_visual';
const VISUAL_TEST_REGISTRATION_TOKEN = 'sf_mrt_visual_regression_token';
const VISUAL_TEST_CREATED_AT = 'Jan 15, 2026, 12:00 PM';
const VISUAL_TEST_EXPIRES_AT = 'Jan 16, 2026, 12:00 PM';

test('manages workspace manual registration tokens from settings', async ({
  page,
  auth,
  projects,
  workspaces,
}) => {
  test.setTimeout(60_000);

  await page.clock.setFixedTime(VISUAL_TEST_NOW);

  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Runner Settings Workspace',
  });
  await projects.createProject({workspaceId: workspace.id});
  await auth.loginAs(page, user);

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
    .filter({hasText: REGISTRATION_TOKEN_PREFIX_RE});
  await expect(rawToken).toBeVisible();
  await rawToken.evaluate((element: Element, token) => {
    element.textContent = token;
  }, VISUAL_TEST_REGISTRATION_TOKEN);
  await expect(createTokenDialog.getByText(VISUAL_TEST_REGISTRATION_TOKEN)).toBeVisible();

  const manualRegistrationTokenRow = page.locator('tr', {hasText: 'E2E runner'});
  await expect(manualRegistrationTokenRow).toBeVisible();
  const manualRegistrationTokenCells = manualRegistrationTokenRow.locator('td');
  await manualRegistrationTokenCells.nth(1).evaluate((element: Element, prefix) => {
    element.textContent = prefix;
  }, VISUAL_TEST_REGISTRATION_TOKEN_PREFIX);
  await manualRegistrationTokenCells.nth(2).evaluate((element: Element, expiresAt) => {
    element.textContent = expiresAt;
  }, VISUAL_TEST_EXPIRES_AT);
  await manualRegistrationTokenCells.nth(3).evaluate((element: Element, createdAt) => {
    element.textContent = createdAt;
  }, VISUAL_TEST_CREATED_AT);
  await argosScreenshot(page, 'runners/settings-runners-create-token-success');

  await page.keyboard.press('Escape');
  await expect(manualRegistrationTokenRow).toBeVisible();

  await manualRegistrationTokenRow
    .getByRole('button', {name: 'Open E2E runner registration token actions'})
    .click();
  await page.getByRole('menuitem', {name: 'Revoke token'}).click();
  const revokeDialog = page.getByRole('dialog', {name: 'Revoke token'});
  await expect(revokeDialog).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/runners/manual-registration-tokens/') &&
        response.url().endsWith('/revoke') &&
        response.status() === 200,
    ),
    revokeDialog.getByRole('button', {name: 'Revoke', exact: true}).click(),
  ]);
  await expect(revokeDialog).toBeHidden();

  await expect(manualRegistrationTokenRow).toHaveCount(0);
  await expect(page.getByText('No usable manual registration tokens')).toBeVisible();
});
