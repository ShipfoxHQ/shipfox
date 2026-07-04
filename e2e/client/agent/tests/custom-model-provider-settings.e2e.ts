import {type AgentHelper, ollamaConfig} from '@shipfox/e2e-helper-agent';
import type {AuthHelper} from '@shipfox/e2e-helper-auth';
import type {ProjectsHelper} from '@shipfox/e2e-helper-projects';
import type {WorkspacesHelper} from '@shipfox/e2e-helper-workspaces';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const OLLAMA = ollamaConfig();
const OLLAMA_MODEL_ID = OLLAMA.model;
const CREATE_PROVIDER_ID = 'local-ollama-create';
const CREATE_PROVIDER_NAME = 'Local Ollama Create';
const EDIT_PROVIDER_ID = 'local-ollama-edit';
const EDIT_PROVIDER_NAME = 'Local Ollama Edit';
const EDITED_PROVIDER_NAME = 'Local Ollama Edited';
const DELETE_PROVIDER_ID = 'local-ollama-delete';
const DELETE_PROVIDER_NAME = 'Local Ollama Delete';
const PROVIDER_SAVE_TIMEOUT_MS = 75_000;

interface ReadyWorkspace {
  sessionToken: string;
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

  return {sessionToken: session.token, workspaceId: workspace.id};
}

async function gotoModelProviders(page: Page, workspaceId: string) {
  await page.goto(`/workspaces/${workspaceId}/settings/model-providers`);
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${workspaceId}/settings/model-providers/?$`, 'u'),
  );
  await expect(page.getByRole('heading', {name: 'Workspace settings'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Configured providers'})).toBeVisible();
}

function configuredProvidersSection(page: Page): ReturnType<Page['locator']> {
  return page.locator('section[aria-label="Configured providers"]');
}

function configuredProviderRow(page: Page, label: string): ReturnType<Page['locator']> {
  return configuredProvidersSection(page)
    .locator('li')
    .filter({has: page.getByText(label, {exact: true})});
}

async function expectProviderInApi(params: {
  agent: AgentHelper;
  displayName: string;
  providerId: string;
  sessionToken: string;
  workspaceId: string;
}) {
  const configs = await params.agent.listModelProviderConfigs({
    workspaceId: params.workspaceId,
    sessionToken: params.sessionToken,
  });
  expect(configs.configs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider_id: params.providerId,
        display_name: params.displayName,
      }),
    ]),
  );
}

test('creates a custom model provider backed by local Ollama', async ({
  page,
  auth,
  agent,
  projects,
  workspaces,
}) => {
  const {workspaceId, sessionToken} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Agent Provider Create Workspace',
  });

  await gotoModelProviders(page, workspaceId);
  await page.getByRole('button', {name: 'Configure custom provider'}).click();
  const dialog = page.getByRole('dialog', {name: 'Add custom provider'});
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Display name').fill(CREATE_PROVIDER_NAME);
  await dialog.getByLabel('Provider ID').fill(CREATE_PROVIDER_ID);
  await dialog.getByLabel('Base URL').fill(OLLAMA.openAiBaseUrl);
  const discoveryResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/agent/custom-model-providers/discover-models') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', {name: 'Fetch models'}).click();
  expect((await discoveryResponse).ok()).toBe(true);

  const defaultModelField = dialog.getByLabel('Default model');
  const discoveredModelOption = defaultModelField.locator('option').filter({
    hasText: OLLAMA_MODEL_ID,
  });
  if ((await discoveredModelOption.count()) === 0) {
    await dialog.getByLabel('Model id').first().fill(OLLAMA_MODEL_ID);
    await dialog.getByLabel('Label').first().fill(OLLAMA_MODEL_ID);
  }
  await expect(defaultModelField).toContainText(OLLAMA_MODEL_ID);

  await defaultModelField.selectOption(OLLAMA_MODEL_ID);
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/agent/custom-model-providers') &&
      response.request().method() === 'POST' &&
      !response.url().includes('/discover-models'),
    {timeout: PROVIDER_SAVE_TIMEOUT_MS},
  );
  await dialog.getByRole('button', {name: 'Test & save'}).click();
  expect((await saveResponse).ok()).toBe(true);

  await expect(page.getByText('Custom provider saved')).toBeVisible();
  await expect(configuredProviderRow(page, CREATE_PROVIDER_NAME)).toBeVisible();
  await expectProviderInApi({
    agent,
    workspaceId,
    sessionToken,
    providerId: CREATE_PROVIDER_ID,
    displayName: CREATE_PROVIDER_NAME,
  });
});

test('edits an existing custom model provider and validates with local Ollama', async ({
  page,
  auth,
  agent,
  projects,
  workspaces,
}) => {
  const {workspaceId, sessionToken} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Agent Provider Edit Workspace',
  });
  await agent.createOllamaCustomProvider({
    workspaceId,
    sessionToken,
    providerId: EDIT_PROVIDER_ID,
    displayName: EDIT_PROVIDER_NAME,
  });

  await gotoModelProviders(page, workspaceId);
  const row = configuredProviderRow(page, EDIT_PROVIDER_NAME);
  await expect(row).toBeVisible();
  await row.getByRole('button', {name: `Open ${EDIT_PROVIDER_NAME} provider actions`}).click();
  await page.getByRole('menuitem', {name: 'Edit'}).click();
  const dialog = page.getByRole('dialog', {name: `Edit ${EDIT_PROVIDER_NAME}`});
  await expect(dialog.getByLabel('Provider ID')).toBeDisabled();

  await dialog.getByLabel('Display name').fill(EDITED_PROVIDER_NAME);
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/agent/custom-model-providers/${EDIT_PROVIDER_ID}`) &&
      response.request().method() === 'PUT',
    {timeout: PROVIDER_SAVE_TIMEOUT_MS},
  );
  await dialog.getByRole('button', {name: 'Test & save'}).click();
  expect((await saveResponse).ok()).toBe(true);

  await expect(page.getByText(`${EDIT_PROVIDER_NAME} saved`)).toBeVisible();
  await expect(configuredProviderRow(page, EDITED_PROVIDER_NAME)).toBeVisible();
  await expect(configuredProviderRow(page, EDIT_PROVIDER_NAME)).toHaveCount(0);
  await expectProviderInApi({
    agent,
    workspaceId,
    sessionToken,
    providerId: EDIT_PROVIDER_ID,
    displayName: EDITED_PROVIDER_NAME,
  });
});

test('deletes an existing custom model provider', async ({
  page,
  auth,
  agent,
  projects,
  workspaces,
}) => {
  const {workspaceId, sessionToken} = await createReadyWorkspace({
    page,
    auth,
    projects,
    workspaces,
    name: 'Agent Provider Delete Workspace',
  });
  await agent.createOllamaCustomProvider({
    workspaceId,
    sessionToken,
    providerId: DELETE_PROVIDER_ID,
    displayName: DELETE_PROVIDER_NAME,
  });

  await gotoModelProviders(page, workspaceId);
  const row = configuredProviderRow(page, DELETE_PROVIDER_NAME);
  await expect(row).toBeVisible();
  await row.getByRole('button', {name: `Open ${DELETE_PROVIDER_NAME} provider actions`}).click();
  await page.getByRole('menuitem', {name: 'Delete'}).click();
  const dialog = page.getByRole('dialog', {name: 'Delete model provider'});
  await dialog.getByRole('button', {name: 'Delete'}).click();

  await expect(page.getByText(`${DELETE_PROVIDER_NAME} deleted`)).toBeVisible();
  await expect(row).toHaveCount(0);
  const configs = await agent.listModelProviderConfigs({workspaceId, sessionToken});
  expect(configs.configs.map((config) => config.provider_id)).not.toContain(DELETE_PROVIDER_ID);
});
