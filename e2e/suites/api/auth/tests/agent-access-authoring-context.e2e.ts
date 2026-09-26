import {
  getWorkflowAuthoringContextResultSchema,
  listWorkspaceModelsResultSchema,
} from '@shipfox/api-agent-access-dto';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createSecret, createVariable} from '@shipfox/e2e-setup-secrets';
import {callToolResult, connectAgentAccessClient} from './agent-access-client.js';
import {expect, test} from './test.js';

const SECRET_VALUE = 'authoring-context-secret-value';
const VARIABLE_VALUE = 'authoring-context-variable-value';

test('returns workspace and project authoring names without values', async ({request, auth}) => {
  const {client, userId, workspaceId} = await connectAgentAccessClient({request, auth});
  try {
    const project = await createProject({workspaceId});
    const common = {workspaceId, actorId: userId};
    await createSecret({...common, key: 'WORKSPACE_TOKEN', value: SECRET_VALUE});
    await createVariable({...common, key: 'WORKSPACE_REGION', value: VARIABLE_VALUE});
    await createSecret({
      ...common,
      projectId: project.id,
      key: 'PROJECT_TOKEN',
      value: SECRET_VALUE,
    });
    await createVariable({
      ...common,
      projectId: project.id,
      key: 'PROJECT_REGION',
      value: VARIABLE_VALUE,
    });

    const workspaceContext = await callToolResult(
      client,
      {name: 'get_workflow_authoring_context', arguments: {}},
      getWorkflowAuthoringContextResultSchema,
    );
    const projectContext = await callToolResult(
      client,
      {name: 'get_workflow_authoring_context', arguments: {project_id: project.id}},
      getWorkflowAuthoringContextResultSchema,
    );
    const workspaceModels = await callToolResult(
      client,
      {
        name: 'list_workspace_models',
        arguments: {provider: 'openai', query: 'LUNA', scored_only: true, limit: 25},
      },
      listWorkspaceModelsResultSchema,
    );

    expect(workspaceContext.secret_names).toEqual(['WORKSPACE_TOKEN']);
    expect(workspaceContext.variable_names).toEqual(['WORKSPACE_REGION']);
    expect(projectContext.secret_names).toEqual(['PROJECT_TOKEN']);
    expect(projectContext.variable_names).toEqual(['PROJECT_REGION']);
    const serialized = JSON.stringify([workspaceContext, projectContext]);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain(VARIABLE_VALUE);
    expect(workspaceModels.models).toEqual([
      expect.objectContaining({
        id: 'gpt-5.6-luna',
        label: expect.any(String),
        lab: expect.any(String),
        provider: 'openai',
        references: expect.arrayContaining([expect.objectContaining({thinking: 'high'})]),
      }),
    ]);
    expect(workspaceModels.next_cursor).toBeNull();
    expect(workspaceContext).toMatchObject({
      model_provider_configured: true,
      attribution: expect.any(String),
      models: expect.arrayContaining([
        expect.objectContaining({
          id: 'gpt-5.6-luna',
          supported_thinking: ['high', 'max', 'default'],
          references: [
            expect.objectContaining({thinking: 'high', intelligence_index: 60}),
            expect.objectContaining({thinking: 'max', intelligence_index: 70}),
          ],
        }),
        expect.objectContaining({id: 'e2e-renewable-pi', references: []}),
      ]),
    });
  } finally {
    await client.close();
  }
});
