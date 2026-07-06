import {createApiClient, preflightCheck} from '@shipfox/e2e-core';
import {message, startFakeOpenAiProvider, toolCall} from '@shipfox/e2e-driver-agent-provider';
import {createConnectedOrg, deleteOrg} from '@shipfox/e2e-driver-gitea';
import {
  createOllamaCustomProvider,
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {resetSuiteRunDir, writeSuiteContext} from '#suite-context.js';

const DETERMINISTIC_AGENT_MODEL = 'deterministic-output-agent';

/**
 * Arranges the whole suite once over HTTP: user, session, workspace, a fresh gitea org
 * connected to the workspace. On any failure it unwinds what it created, since
 * Playwright skips global teardown when setup throws.
 */
export default async function globalSetup(): Promise<void> {
  await preflightCheck({requireClient: false});
  resetSuiteRunDir();
  const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

  const cleanups: Array<() => Promise<void>> = [];
  try {
    const user = await createUser();
    // The access token snapshots memberships at sign time; workspace-scoped calls need it.
    const workspace = await createWorkspace({userId: user.user.id, userEmail: user.email});
    const session = await createSession({user_id: user.user.id});

    const org = await createConnectedOrg({
      workspaceId: workspace.id,
      sessionToken: session.token,
    });
    cleanups.push(() => deleteOrg({org: org.org}).catch(() => undefined));

    const fakeProvider = await startFakeOpenAiProvider({runId});
    cleanups.push(() => fakeProvider.stop().catch(() => undefined));
    const agentScript = await fakeProvider.createScript({
      id: `${runId}-agent-output-tool`,
      model: DETERMINISTIC_AGENT_MODEL,
      responses: [
        message('ok'),
        toolCall('set_output', {key: 'message', value: 'qwen-tool-output-ok'}),
        message('done'),
      ],
      assertions: [{kind: 'model', equals: DETERMINISTIC_AGENT_MODEL}],
    });
    const agentProvider = await createOpenAiCompatibleCustomProvider({
      workspaceId: workspace.id,
      sessionToken: session.token,
      providerId: `det-output-tool-${runId}`,
      displayName: 'Deterministic Output Tool E2E',
      baseUrl: agentScript.providerBaseUrl,
      model: agentScript.model,
      modelMetadata: {max_output_tokens: 512},
    });
    cleanups.push(() =>
      deleteModelProviderConfig({
        workspaceId: workspace.id,
        sessionToken: session.token,
        providerId: agentProvider.provider_id,
      }).catch(() => undefined),
    );

    const ollamaProvider = await createOllamaCustomProvider({
      workspaceId: workspace.id,
      sessionToken: session.token,
      providerId: 'local-ollama-e2e',
      displayName: 'Local Ollama E2E',
    });
    cleanups.push(() =>
      deleteModelProviderConfig({
        workspaceId: workspace.id,
        sessionToken: session.token,
        providerId: ollamaProvider.provider_id,
      }).catch(() => undefined),
    );
    await setDefaultModelProvider({
      workspaceId: workspace.id,
      sessionToken: session.token,
      providerId: ollamaProvider.provider_id,
    });

    writeSuiteContext({
      runId,
      workspaceId: workspace.id,
      sessionToken: session.token,
      org: org.org,
      connectionId: org.connection.id,
      connectionSlug: org.connection.slug,
      agentProviderId: agentProvider.provider_id,
      agentModel: agentScript.model,
      fakeProviderRunId: runId,
    });
  } catch (error) {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
    throw error;
  }
}

async function setDefaultModelProvider(params: {
  workspaceId: string;
  sessionToken: string;
  providerId: string;
}): Promise<void> {
  const client = createApiClient({token: params.sessionToken});
  await client.requestJson(
    'put',
    `/workspaces/${params.workspaceId}/agent/default-model-provider`,
    {json: {provider_id: params.providerId}},
  );
}
