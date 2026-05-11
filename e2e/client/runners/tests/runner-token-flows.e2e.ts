import {argosScreenshot} from '@shipfox/playwright';
import {expect, test} from './test.js';

const RUNNER_TOKEN_PREFIX_RE = /^sf_rt_/u;
const VISUAL_TEST_NOW = new Date('2026-01-15T12:00:00Z');
const VISUAL_TEST_RUNNER_TOKEN = 'sf_rt_visual_regression_token';

test('manages workspace runner tokens from settings', async ({page, auth, workspaces}) => {
  await page.clock.setFixedTime(VISUAL_TEST_NOW);

  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Runner Settings Workspace',
  });
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${workspace.id}/settings/runners`);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}/settings/runners/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Workspace settings'})).toBeVisible();
  await expect(page.getByText('No usable runner tokens')).toBeVisible();
  await argosScreenshot(page, 'runners/settings-runners-empty');

  await page.getByRole('button', {name: 'Create token'}).click();
  const createTokenDialog = page.getByRole('dialog', {name: 'Create runner token'});
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
  await argosScreenshot(page, 'runners/settings-runners-create-token-success');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Revoke E2E runner'})).toBeVisible();

  await page.getByRole('button', {name: 'Revoke E2E runner'}).click();
  await page.getByRole('button', {name: 'Revoke', exact: true}).last().click();

  await expect(page.getByRole('button', {name: 'Revoke E2E runner'})).toHaveCount(0);
  await expect(page.getByText('No usable runner tokens')).toBeVisible();
});
