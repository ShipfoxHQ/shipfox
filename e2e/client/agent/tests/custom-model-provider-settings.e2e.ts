import {type AgentHelper, ollamaConfig} from '@shipfox/e2e-helper-agent';
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
  agent,
  customModelProviders,
  createReadyWorkspace,
}) => {
  const {workspaceId, sessionToken} = await createReadyWorkspace({
    name: 'Agent Provider Create Workspace',
  });

  await customModelProviders.goto(workspaceId);
  const dialog = await customModelProviders.openCreateDialog();

  await customModelProviders.fillProviderIdentity(dialog, {
    displayName: CREATE_PROVIDER_NAME,
    providerId: CREATE_PROVIDER_ID,
    baseUrl: OLLAMA.openAiBaseUrl,
  });
  const discoveryResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/agent/custom-model-providers/discover-models') &&
      response.request().method() === 'POST',
  );
  await customModelProviders.fetchModels(dialog);
  expect((await discoveryResponse).ok()).toBe(true);

  const defaultModelField = customModelProviders.defaultModelField(dialog);
  const discoveredModelOption = customModelProviders.discoveredModelOption(dialog, OLLAMA_MODEL_ID);
  if ((await discoveredModelOption.count()) === 0) {
    await customModelProviders.firstModelIdField(dialog).fill(OLLAMA_MODEL_ID);
    await customModelProviders.firstModelLabelField(dialog).fill(OLLAMA_MODEL_ID);
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
  await customModelProviders.save(dialog);
  expect((await saveResponse).ok()).toBe(true);

  await customModelProviders.expectSavedToast('Custom provider saved');
  await expect(customModelProviders.configuredProviderRow(CREATE_PROVIDER_NAME)).toBeVisible();
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
  agent,
  customModelProviders,
  createReadyWorkspace,
}) => {
  const {workspaceId, sessionToken} = await createReadyWorkspace({
    name: 'Agent Provider Edit Workspace',
  });
  await agent.createOllamaCustomProvider({
    workspaceId,
    sessionToken,
    providerId: EDIT_PROVIDER_ID,
    displayName: EDIT_PROVIDER_NAME,
  });

  await customModelProviders.goto(workspaceId);
  const row = customModelProviders.configuredProviderRow(EDIT_PROVIDER_NAME);
  await expect(row).toBeVisible();
  const dialog = await customModelProviders.openEditDialog(EDIT_PROVIDER_NAME);
  await expect(dialog.field('Provider ID')).toBeDisabled();

  await dialog.field('Display name').fill(EDITED_PROVIDER_NAME);
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/agent/custom-model-providers/${EDIT_PROVIDER_ID}`) &&
      response.request().method() === 'PUT',
    {timeout: PROVIDER_SAVE_TIMEOUT_MS},
  );
  await customModelProviders.save(dialog);
  expect((await saveResponse).ok()).toBe(true);

  await customModelProviders.expectSavedToast(`${EDIT_PROVIDER_NAME} saved`);
  await expect(customModelProviders.configuredProviderRow(EDITED_PROVIDER_NAME)).toBeVisible();
  await expect(customModelProviders.configuredProviderRow(EDIT_PROVIDER_NAME)).toHaveCount(0);
  await expectProviderInApi({
    agent,
    workspaceId,
    sessionToken,
    providerId: EDIT_PROVIDER_ID,
    displayName: EDITED_PROVIDER_NAME,
  });
});

test('deletes an existing custom model provider', async ({
  agent,
  customModelProviders,
  createReadyWorkspace,
}) => {
  const {workspaceId, sessionToken} = await createReadyWorkspace({
    name: 'Agent Provider Delete Workspace',
  });
  await agent.createOllamaCustomProvider({
    workspaceId,
    sessionToken,
    providerId: DELETE_PROVIDER_ID,
    displayName: DELETE_PROVIDER_NAME,
  });

  await customModelProviders.goto(workspaceId);
  const row = customModelProviders.configuredProviderRow(DELETE_PROVIDER_NAME);
  await expect(row).toBeVisible();
  const dialog = await customModelProviders.openDeleteDialog(DELETE_PROVIDER_NAME);
  await dialog.confirm('Delete');

  await customModelProviders.expectSavedToast(`${DELETE_PROVIDER_NAME} deleted`);
  await expect(row).toHaveCount(0);
  const configs = await agent.listModelProviderConfigs({workspaceId, sessionToken});
  expect(configs.configs.map((config) => config.provider_id)).not.toContain(DELETE_PROVIDER_ID);
});
