import type {AuthHelper} from '@shipfox/e2e-helper-auth';
import type {ProjectsHelper} from '@shipfox/e2e-helper-projects';
import {mintManualRegistrationToken, mintProvisionerToken} from '@shipfox/e2e-helper-runners';
import type {WorkspacesHelper} from '@shipfox/e2e-helper-workspaces';
import type {Page} from '@shipfox/playwright';
import {argosScreenshot} from '@shipfox/playwright';
import {createShipfoxTokenPrefixRegexes} from '@shipfox/regex';
import {expect, test} from './test.js';

const MANUAL_REGISTRATION_TOKEN_PREFIX_RE = createShipfoxTokenPrefixRegexes(['mrt']).unqualified;
const PROVISIONER_TOKEN_PREFIX_RE = createShipfoxTokenPrefixRegexes(['pt']).unqualified;
const VISUAL_TEST_NOW = new Date('2026-01-15T12:00:00Z');
const VISUAL_TEST_MANUAL_TOKEN_PREFIX = 'sf_mrt_visual';
const VISUAL_TEST_MANUAL_TOKEN = 'sf_mrt_visual_regression_token';
const VISUAL_TEST_PROVISIONER_TOKEN_PREFIX = 'sf_pt_visual';
const VISUAL_TEST_PROVISIONER_TOKEN = 'sf_pt_visual_regression_token';
const VISUAL_TEST_CREATED_AT = 'Jan 15, 2026, 12:00 PM';
const VISUAL_TEST_EXPIRES_AT = 'Jan 16, 2026, 12:00 PM';

interface ReadyWorkspace {
  userToken: string;
  workspaceId: string;
}

async function createReadyWorkspace(params: {
  auth: AuthHelper;
  page: Page;
  projects: ProjectsHelper;
  workspaces: WorkspacesHelper;
  name: string;
}): Promise<ReadyWorkspace> {
  const user = await params.auth.createUser();
  const workspace = await params.workspaces.create({
    userId: user.user.id,
    name: params.name,
  });
  await params.projects.createProject({workspaceId: workspace.id});
  const session = await params.auth.createSession({user_id: user.user.id});
  await params.auth.loginAs(params.page, user);

  return {userToken: session.token, workspaceId: workspace.id};
}

function manualTokensSection(page: Page) {
  return page.locator('section', {hasText: 'Runner registration tokens'});
}

function provisionerTokensSection(page: Page) {
  return page.locator('section', {hasText: 'Runner provisioner registration tokens'});
}

function rowByName(section: ReturnType<typeof manualTokensSection>, name: string) {
  return section.locator('tr', {hasText: name});
}

async function gotoManualTokensSettings(page: Page, workspaceId: string) {
  await page.goto(`/workspaces/${workspaceId}/settings/runners`);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/runners/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Workspace settings'})).toBeVisible();
}

async function gotoProvisionerTokensSettings(page: Page, workspaceId: string) {
  await page.goto(`/workspaces/${workspaceId}/settings/provisioners`);
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${workspaceId}/settings/provisioners/?$`, 'u'),
  );
  await expect(page.getByRole('heading', {name: 'Workspace settings'})).toBeVisible();
}

async function normalizeManualTokenRowForVisuals(
  row: ReturnType<typeof rowByName>,
  params: {prefix: string; expiresAt: string; createdAt: string},
) {
  const cells = row.locator('td');
  await cells.nth(1).evaluate((element: Element, prefix) => {
    element.textContent = prefix;
  }, params.prefix);
  await cells.nth(2).evaluate((element: Element, expiresAt) => {
    element.textContent = expiresAt;
  }, params.expiresAt);
  await cells.nth(3).evaluate((element: Element, createdAt) => {
    element.textContent = createdAt;
  }, params.createdAt);
}

async function normalizeProvisionerTokenRowForVisuals(
  row: ReturnType<typeof rowByName>,
  params: {prefix: string; expiresAt: string; createdAt: string},
) {
  const cells = row.locator('td');
  await cells.nth(1).evaluate((element: Element, prefix) => {
    element.textContent = prefix;
  }, params.prefix);
  await cells.nth(3).evaluate((element: Element, expiresAt) => {
    element.textContent = expiresAt;
  }, params.expiresAt);
  await cells.nth(4).evaluate((element: Element, createdAt) => {
    element.textContent = createdAt;
  }, params.createdAt);
}

test('creates a manual runner registration token from settings', async ({
  page,
  auth,
  projects,
  workspaces,
}) => {
  test.setTimeout(60_000);

  await page.clock.setFixedTime(VISUAL_TEST_NOW);
  const {workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Manual Token Create Workspace',
  });

  await gotoManualTokensSettings(page, workspaceId);
  const section = manualTokensSection(page);
  await expect(section.getByText('No usable manual registration tokens')).toBeVisible();
  await argosScreenshot(page, 'runners/settings-runners-empty');

  await section.getByRole('button', {name: 'Create token'}).click();
  const createTokenDialog = page.getByRole('dialog', {name: 'Create manual registration token'});
  await expect(createTokenDialog).toBeVisible();
  await expect(createTokenDialog.getByLabel('Token name')).toBeVisible();
  await expect(createTokenDialog.getByRole('button', {name: 'Create token'})).toBeVisible();
  await argosScreenshot(page, 'runners/settings-runners-create-token-form');

  await createTokenDialog.getByLabel('Token name').fill('E2E manual runner');
  await createTokenDialog.getByRole('button', {name: 'Create token'}).click();

  await expect(createTokenDialog.getByText('Token created')).toBeVisible();
  const rawToken = createTokenDialog
    .locator('p.font-code')
    .filter({hasText: MANUAL_REGISTRATION_TOKEN_PREFIX_RE});
  await expect(rawToken).toBeVisible();
  await rawToken.evaluate((element: Element, token) => {
    element.textContent = token;
  }, VISUAL_TEST_MANUAL_TOKEN);
  await expect(createTokenDialog.getByText(VISUAL_TEST_MANUAL_TOKEN)).toBeVisible();

  const row = rowByName(section, 'E2E manual runner');
  await expect(row).toBeVisible();
  await normalizeManualTokenRowForVisuals(row, {
    prefix: VISUAL_TEST_MANUAL_TOKEN_PREFIX,
    expiresAt: VISUAL_TEST_EXPIRES_AT,
    createdAt: VISUAL_TEST_CREATED_AT,
  });
  await argosScreenshot(page, 'runners/settings-runners-create-token-success');
});

test('revokes a manual runner registration token from settings', async ({
  page,
  auth,
  projects,
  workspaces,
}) => {
  const {userToken, workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Manual Token Revoke Workspace',
  });
  await mintManualRegistrationToken({
    workspaceId,
    userToken,
    name: 'E2E manual revoke runner',
    ttlSeconds: 3600,
  });

  await gotoManualTokensSettings(page, workspaceId);
  const section = manualTokensSection(page);
  const row = rowByName(section, 'E2E manual revoke runner');
  await expect(row).toBeVisible();

  await row
    .getByRole('button', {name: 'Open E2E manual revoke runner registration token actions'})
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

  await expect(row).toHaveCount(0);
  await expect(section.getByText('No usable manual registration tokens')).toBeVisible();
});

test('creates a provisioner registration token from settings', async ({
  page,
  auth,
  projects,
  workspaces,
}) => {
  test.setTimeout(60_000);

  await page.clock.setFixedTime(VISUAL_TEST_NOW);
  const {workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Provisioner Token Create Workspace',
  });

  await gotoProvisionerTokensSettings(page, workspaceId);
  const section = provisionerTokensSection(page);
  await expect(section.getByText('No usable provisioner registration tokens')).toBeVisible();
  await argosScreenshot(page, 'runners/settings-provisioners-empty');

  await section.getByRole('button', {name: 'Create token'}).click();
  const createTokenDialog = page.getByRole('dialog', {
    name: 'Create provisioner registration token',
  });
  await expect(createTokenDialog).toBeVisible();
  await expect(createTokenDialog.getByLabel('Token name')).toBeVisible();
  await expect(createTokenDialog.getByRole('button', {name: 'Create token'})).toBeVisible();
  await argosScreenshot(page, 'runners/settings-provisioners-create-token-form');

  await createTokenDialog.getByLabel('Token name').fill('E2E provisioner');
  await createTokenDialog.getByRole('button', {name: 'Create token'}).click();

  await expect(createTokenDialog.getByText('Token created')).toBeVisible();
  const rawToken = createTokenDialog.locator('p.font-code').filter({
    hasText: PROVISIONER_TOKEN_PREFIX_RE,
  });
  await expect(rawToken).toBeVisible();
  await rawToken.evaluate((element: Element, token) => {
    element.textContent = token;
  }, VISUAL_TEST_PROVISIONER_TOKEN);
  await expect(createTokenDialog.getByText(VISUAL_TEST_PROVISIONER_TOKEN)).toBeVisible();

  const row = rowByName(section, 'E2E provisioner');
  await expect(row).toBeVisible();
  await normalizeProvisionerTokenRowForVisuals(row, {
    prefix: VISUAL_TEST_PROVISIONER_TOKEN_PREFIX,
    expiresAt: VISUAL_TEST_EXPIRES_AT,
    createdAt: VISUAL_TEST_CREATED_AT,
  });
  await argosScreenshot(page, 'runners/settings-provisioners-create-token-success');
});

test('revokes a provisioner registration token from settings', async ({
  page,
  auth,
  projects,
  workspaces,
}) => {
  const {userToken, workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Provisioner Token Revoke Workspace',
  });
  await mintProvisionerToken({
    workspaceId,
    userToken,
    name: 'E2E revoke provisioner',
    ttlSeconds: 3600,
  });

  await gotoProvisionerTokensSettings(page, workspaceId);
  const section = provisionerTokensSection(page);
  const row = rowByName(section, 'E2E revoke provisioner');
  await expect(row).toBeVisible();

  await row.getByRole('button', {name: 'Open E2E revoke provisioner token actions'}).click();
  await page.getByRole('menuitem', {name: 'Revoke token'}).click();
  const revokeDialog = page.getByRole('dialog', {name: 'Revoke token'});
  await expect(revokeDialog).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/provisioners/tokens/') &&
        response.url().endsWith('/revoke') &&
        response.status() === 200,
    ),
    revokeDialog.getByRole('button', {name: 'Revoke', exact: true}).click(),
  ]);
  await expect(revokeDialog).toBeHidden();

  await expect(row).toHaveCount(0);
  await expect(section.getByText('No usable provisioner registration tokens')).toBeVisible();
});
