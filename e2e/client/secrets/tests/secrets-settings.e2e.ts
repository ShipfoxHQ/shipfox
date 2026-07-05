import {expect, test} from './test.js';

const SECRET_CREATE_KEY = 'E2E_SECRET_CREATE';
const SECRET_EDIT_KEY = 'E2E_SECRET_EDIT';
const SECRET_DELETE_KEY = 'E2E_SECRET_DELETE';
const VARIABLE_CREATE_KEY = 'E2E_VARIABLE_CREATE';
const VARIABLE_EDIT_KEY = 'E2E_VARIABLE_EDIT';
const VARIABLE_DELETE_KEY = 'E2E_VARIABLE_DELETE';

test('creates a workspace secret from settings', async ({secretsScreen, createReadyWorkspace}) => {
  const {workspaceId} = await createReadyWorkspace({
    name: 'Secrets Create Workspace',
  });
  const value = 'secret-create-value-e2e';

  await secretsScreen.goto(workspaceId);
  await expect(secretsScreen.emptyState()).toBeVisible();
  await secretsScreen.createSecret(SECRET_CREATE_KEY, value);

  await expect(secretsScreen.valueHidden(SECRET_CREATE_KEY)).toBeVisible();
  await expect(secretsScreen.section()).not.toContainText(value);
});

test('edits a workspace secret from settings', async ({
  secrets,
  secretsScreen,
  createReadyWorkspace,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
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

  await secretsScreen.goto(workspaceId);
  const dialog = await secretsScreen.openUpdateDialog(SECRET_EDIT_KEY);
  await expect(dialog.field('Name')).toBeDisabled();
  await expect(dialog.field('Name')).toHaveValue(SECRET_EDIT_KEY);

  await dialog.locator().getByRole('textbox', {name: 'Value'}).fill(newValue);
  await dialog.confirm('Update secret');

  await expect(secretsScreen.toastMessage('Secret updated')).toBeVisible();
  await expect(secretsScreen.rowByKey(SECRET_EDIT_KEY)).toBeVisible();
  await expect(secretsScreen.section()).not.toContainText(oldValue);
  await expect(secretsScreen.section()).not.toContainText(newValue);
});

test('deletes a workspace secret from settings', async ({
  secrets,
  secretsScreen,
  createReadyWorkspace,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
    name: 'Secrets Delete Workspace',
  });
  await secrets.createSecret({
    workspaceId,
    actorId: userId,
    key: SECRET_DELETE_KEY,
    value: 'secret-delete-value-e2e',
  });

  await secretsScreen.goto(workspaceId);
  const row = secretsScreen.rowByKey(SECRET_DELETE_KEY);
  await secretsScreen.deleteSecret(SECRET_DELETE_KEY);

  await expect(row).toHaveCount(0);
  await expect(secretsScreen.emptyState()).toBeVisible();
});

test('creates a workspace variable from settings', async ({
  variablesScreen,
  createReadyWorkspace,
}) => {
  const {workspaceId} = await createReadyWorkspace({
    name: 'Variables Create Workspace',
  });
  const value = 'debug';

  await variablesScreen.goto(workspaceId);
  await expect(variablesScreen.emptyState()).toBeVisible();
  await variablesScreen.createVariable(VARIABLE_CREATE_KEY, value);

  await expect(
    variablesScreen.rowByKey(VARIABLE_CREATE_KEY).getByText(value, {exact: true}),
  ).toBeVisible();
});

test('edits a workspace variable from settings', async ({
  secrets,
  variablesScreen,
  createReadyWorkspace,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
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

  await variablesScreen.goto(workspaceId);
  const row = variablesScreen.rowByKey(VARIABLE_EDIT_KEY);
  await expect(row.getByText(oldValue, {exact: true})).toBeVisible();
  const dialog = await variablesScreen.openUpdateDialog(VARIABLE_EDIT_KEY);
  await expect(dialog.field('Name')).toBeDisabled();
  await expect(dialog.field('Name')).toHaveValue(VARIABLE_EDIT_KEY);

  await dialog.locator().getByRole('textbox', {name: 'Value'}).fill(newValue);
  await dialog.confirm('Update variable');

  await expect(variablesScreen.toastMessage('Variable updated')).toBeVisible();
  await expect(row.getByText(newValue, {exact: true})).toBeVisible();
  await expect(row).not.toContainText(oldValue);
});

test('deletes a workspace variable from settings', async ({
  secrets,
  variablesScreen,
  createReadyWorkspace,
}) => {
  const {userId, workspaceId} = await createReadyWorkspace({
    name: 'Variables Delete Workspace',
  });
  await secrets.createVariable({
    workspaceId,
    actorId: userId,
    key: VARIABLE_DELETE_KEY,
    value: 'trace',
  });

  await variablesScreen.goto(workspaceId);
  const row = variablesScreen.rowByKey(VARIABLE_DELETE_KEY);
  await variablesScreen.deleteVariable(VARIABLE_DELETE_KEY);

  await expect(row).toHaveCount(0);
  await expect(variablesScreen.emptyState()).toBeVisible();
});
