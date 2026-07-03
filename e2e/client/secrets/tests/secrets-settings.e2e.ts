import type {AuthHelper} from '@shipfox/e2e-helper-auth';
import type {ProjectsHelper} from '@shipfox/e2e-helper-projects';
import type {WorkspacesHelper} from '@shipfox/e2e-helper-workspaces';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const SECRET_CREATE_KEY = 'E2E_SECRET_CREATE';
const SECRET_EDIT_KEY = 'E2E_SECRET_EDIT';
const SECRET_DELETE_KEY = 'E2E_SECRET_DELETE';
const VARIABLE_CREATE_KEY = 'E2E_VARIABLE_CREATE';
const VARIABLE_EDIT_KEY = 'E2E_VARIABLE_EDIT';
const VARIABLE_DELETE_KEY = 'E2E_VARIABLE_DELETE';

interface ReadyWorkspace {
  userId: string;
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
  await params.auth.loginAs(params.page, user);

  return {userId: user.user.id, workspaceId: workspace.id};
}

function secretsSection(page: Page) {
  return page.locator('section[aria-label="Secrets"]');
}

function variablesSection(page: Page) {
  return page.locator('section[aria-label="Variables"]');
}

function rowByKey(section: ReturnType<typeof secretsSection>, key: string) {
  return section.locator('tr', {hasText: key});
}

async function gotoSecrets(page: Page, workspaceId: string) {
  await page.goto(`/workspaces/${workspaceId}/settings/secrets`);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/secrets/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Workspace settings'})).toBeVisible();
}

async function gotoVariables(page: Page, workspaceId: string) {
  await page.goto(`/workspaces/${workspaceId}/settings/variables`);
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/variables/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Workspace settings'})).toBeVisible();
}

async function createSecretFromSettings(page: Page, key: string, value: string) {
  const section = secretsSection(page);
  await section.getByRole('button', {name: 'Create secret'}).first().click();
  const dialog = page.getByRole('dialog', {name: 'Create secret'});
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Name').fill(key);
  await dialog.getByRole('textbox', {name: 'Value'}).fill(value);
  await dialog.getByRole('button', {name: 'Create secret'}).click();

  await expect(page.getByText('Secret created')).toBeVisible();
  await expect(rowByKey(section, key)).toBeVisible();
}

async function createVariableFromSettings(page: Page, key: string, value: string) {
  const section = variablesSection(page);
  await section.getByRole('button', {name: 'Create variable'}).first().click();
  const dialog = page.getByRole('dialog', {name: 'Create variable'});
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Name').fill(key);
  await dialog.getByRole('textbox', {name: 'Value'}).fill(value);
  await dialog.getByRole('button', {name: 'Create variable'}).click();

  await expect(page.getByText('Variable created')).toBeVisible();
  await expect(rowByKey(section, key)).toBeVisible();
}

test('creates a workspace secret from settings', async ({page, auth, projects, workspaces}) => {
  const {workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Secrets Create Workspace',
  });
  const value = 'secret-create-value-e2e';

  await gotoSecrets(page, workspaceId);
  await expect(secretsSection(page).getByText('No secrets yet')).toBeVisible();
  await createSecretFromSettings(page, SECRET_CREATE_KEY, value);

  const row = rowByKey(secretsSection(page), SECRET_CREATE_KEY);
  await expect(row.getByLabel('Value hidden')).toBeVisible();
  await expect(secretsSection(page)).not.toContainText(value);
});

test('edits a workspace secret from settings', async ({
  page,
  auth,
  projects,
  workspaces,
  secrets,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Secrets Edit Workspace',
  });
  const oldValue = 'secret-edit-old-value-e2e';
  const newValue = 'secret-edit-new-value-e2e';
  await secrets.createSecret({
    workspaceId,
    actorId: userId,
    key: SECRET_EDIT_KEY,
    value: oldValue,
  });

  await gotoSecrets(page, workspaceId);
  const row = rowByKey(secretsSection(page), SECRET_EDIT_KEY);
  await row.getByRole('button', {name: `Actions for ${SECRET_EDIT_KEY}`}).click();
  await page.getByRole('menuitem', {name: 'Edit value'}).click();
  const dialog = page.getByRole('dialog', {name: 'Update secret'});
  await expect(dialog.getByLabel('Name')).toBeDisabled();
  await expect(dialog.getByLabel('Name')).toHaveValue(SECRET_EDIT_KEY);

  await dialog.getByRole('textbox', {name: 'Value'}).fill(newValue);
  await dialog.getByRole('button', {name: 'Update secret'}).click();

  await expect(page.getByText('Secret updated')).toBeVisible();
  await expect(row).toBeVisible();
  await expect(secretsSection(page)).not.toContainText(oldValue);
  await expect(secretsSection(page)).not.toContainText(newValue);
});

test('deletes a workspace secret from settings', async ({
  page,
  auth,
  projects,
  workspaces,
  secrets,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Secrets Delete Workspace',
  });
  await secrets.createSecret({
    workspaceId,
    actorId: userId,
    key: SECRET_DELETE_KEY,
    value: 'secret-delete-value-e2e',
  });

  await gotoSecrets(page, workspaceId);
  const section = secretsSection(page);
  const row = rowByKey(section, SECRET_DELETE_KEY);
  await row.getByRole('button', {name: `Actions for ${SECRET_DELETE_KEY}`}).click();
  await page.getByRole('menuitem', {name: 'Delete'}).click();
  const dialog = page.getByRole('dialog', {name: new RegExp(`Delete ${SECRET_DELETE_KEY}`, 'u')});
  await dialog.getByRole('button', {name: 'Delete'}).click();

  await expect(page.getByText('Secret deleted')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(section.getByText('No secrets yet')).toBeVisible();
});

test('creates a workspace variable from settings', async ({page, auth, projects, workspaces}) => {
  const {workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Variables Create Workspace',
  });
  const value = 'debug';

  await gotoVariables(page, workspaceId);
  await expect(variablesSection(page).getByText('No variables yet')).toBeVisible();
  await createVariableFromSettings(page, VARIABLE_CREATE_KEY, value);

  const row = rowByKey(variablesSection(page), VARIABLE_CREATE_KEY);
  await expect(row.getByText(value, {exact: true})).toBeVisible();
});

test('edits a workspace variable from settings', async ({
  page,
  auth,
  projects,
  workspaces,
  secrets,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Variables Edit Workspace',
  });
  const oldValue = 'info';
  const newValue = 'debug';
  await secrets.createVariable({
    workspaceId,
    actorId: userId,
    key: VARIABLE_EDIT_KEY,
    value: oldValue,
  });

  await gotoVariables(page, workspaceId);
  const section = variablesSection(page);
  const row = rowByKey(section, VARIABLE_EDIT_KEY);
  await expect(row.getByText(oldValue, {exact: true})).toBeVisible();
  await row.getByRole('button', {name: `Actions for ${VARIABLE_EDIT_KEY}`}).click();
  await page.getByRole('menuitem', {name: 'Edit value'}).click();
  const dialog = page.getByRole('dialog', {name: 'Update variable'});
  await expect(dialog.getByLabel('Name')).toBeDisabled();
  await expect(dialog.getByLabel('Name')).toHaveValue(VARIABLE_EDIT_KEY);

  await dialog.getByRole('textbox', {name: 'Value'}).fill(newValue);
  await dialog.getByRole('button', {name: 'Update variable'}).click();

  await expect(page.getByText('Variable updated')).toBeVisible();
  await expect(row.getByText(newValue, {exact: true})).toBeVisible();
  await expect(row).not.toContainText(oldValue);
});

test('deletes a workspace variable from settings', async ({
  page,
  auth,
  projects,
  workspaces,
  secrets,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Variables Delete Workspace',
  });
  await secrets.createVariable({
    workspaceId,
    actorId: userId,
    key: VARIABLE_DELETE_KEY,
    value: 'trace',
  });

  await gotoVariables(page, workspaceId);
  const section = variablesSection(page);
  const row = rowByKey(section, VARIABLE_DELETE_KEY);
  await row.getByRole('button', {name: `Actions for ${VARIABLE_DELETE_KEY}`}).click();
  await page.getByRole('menuitem', {name: 'Delete'}).click();
  const dialog = page.getByRole('dialog', {
    name: new RegExp(`Delete ${VARIABLE_DELETE_KEY}`, 'u'),
  });
  await dialog.getByRole('button', {name: 'Delete'}).click();

  await expect(page.getByText('Variable deleted')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(section.getByText('No variables yet')).toBeVisible();
});
