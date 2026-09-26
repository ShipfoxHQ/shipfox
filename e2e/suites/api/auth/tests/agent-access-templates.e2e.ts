import {randomUUID} from 'node:crypto';
import {
  getWorkflowTemplateResultSchema,
  listWorkflowTemplatesResultSchema,
} from '@shipfox/api-agent-access-dto';
import {createGithubConnection, createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {callToolEnvelope, callToolResult, connectAgentAccessClient} from './agent-access-client.js';
import {expect, test} from './test.js';

const SHIPPED_TEMPLATE_IDS = ['ask-codebase', 'fix-dependency-ci', 'ticket-to-pr'];

async function createGithubProject(workspaceId: string) {
  const uniqueId = randomUUID().replaceAll('-', '').slice(0, 10);
  const connection = await createGithubConnection({
    workspaceId,
    installationId: Number.parseInt(uniqueId.slice(0, 7), 16) + 1,
    accountLogin: `t${uniqueId.slice(0, 5)}`,
    displayName: `GitHub Templates ${uniqueId}`,
    installerUserId: randomUUID(),
  });
  const project = await createProject({
    workspaceId,
    name: `Templates Project ${uniqueId}`,
    sourceConnectionId: connection.id,
    sourceExternalRepositoryId: `github:${Number.parseInt(uniqueId.slice(0, 7), 16)}`,
    sourceRepositoryOwner: 'shipfox',
    sourceRepositoryName: 'templates-e2e',
    sourceDefaultBranch: 'main',
  });
  return {connection, project};
}

async function createLinearTracker(workspaceId: string) {
  const organizationId = randomUUID();
  return await createLinearConnection({
    workspaceId,
    organizationId,
    organizationUrlKey: `templates-e2e-${organizationId}`,
    appUserId: `templates-e2e-app-user-${organizationId}`,
    displayName: 'Linear Templates E2E',
    accessToken: `templates-e2e-token-${organizationId}`,
  });
}

test.describe('agent-access workflow templates', () => {
  test('flips ticket to PR compatibility when a tracker connection is added', async ({
    request,
    auth,
  }) => {
    const {client, workspaceId} = await connectAgentAccessClient({request, auth});
    try {
      const {connection: github} = await createGithubProject(workspaceId);

      const before = await callToolResult(
        client,
        {name: 'list_workflow_templates', arguments: {}},
        listWorkflowTemplatesResultSchema,
      );
      const linear = await createLinearTracker(workspaceId);
      const after = await callToolResult(
        client,
        {name: 'list_workflow_templates', arguments: {}},
        listWorkflowTemplatesResultSchema,
      );

      expect(before.templates.map(({id}) => id)).toEqual(SHIPPED_TEMPLATE_IDS);
      expect(before.templates.find(({id}) => id === 'fix-dependency-ci')).toMatchObject({
        compatible: true,
        missing_providers: [],
      });
      expect(before.templates.find(({id}) => id === 'ticket-to-pr')).toMatchObject({
        compatible: false,
        missing_providers: ['linear'],
      });
      expect(before.templates.find(({id}) => id === 'ask-codebase')).toMatchObject({
        compatible: false,
        missing_providers: ['slack'],
      });
      expect(after.templates.find(({id}) => id === 'ticket-to-pr')).toMatchObject({
        compatible: true,
        missing_providers: [],
        roles: expect.arrayContaining([
          {
            role: 'tracker',
            from_project: false,
            providers: [{provider: 'linear', compatible: true, suggested_bindings: [linear.slug]}],
          },
          {
            role: 'source',
            from_project: true,
            providers: [{provider: 'github', compatible: true, suggested_bindings: [github.slug]}],
          },
        ]),
      });
    } finally {
      await client.close();
    }
  });

  test('composes ticket to PR with project and tracker bindings and model choices', async ({
    request,
    auth,
  }) => {
    const {client, workspaceId} = await connectAgentAccessClient({request, auth});
    try {
      const {connection: github, project} = await createGithubProject(workspaceId);
      const linear = await createLinearTracker(workspaceId);

      const template = await callToolResult(
        client,
        {
          name: 'get_workflow_template',
          arguments: {template_id: 'ticket-to-pr', project_id: project.id, tracker: 'linear'},
        },
        getWorkflowTemplateResultSchema,
      );

      expect(template.suggested_bindings).toEqual({source: [github.slug], tracker: [linear.slug]});
      expect(() => parseWorkflowDocument(parseYaml(template.workflow_yaml))).not.toThrow();
      const fix = template.suggested_models.fix;
      expect(fix).toMatchObject({
        outcome: 'list',
        reference: null,
        attribution: expect.any(String),
      });
      expect(fix?.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'e2e-scored-efficient',
            thinking: 'medium',
            reference: expect.objectContaining({intelligence_index: 72, cost_per_task_usd: 0.8}),
          }),
          expect.objectContaining({id: 'gpt-5.6-luna', thinking: 'max'}),
          expect.objectContaining({id: 'e2e-renewable-pi', thinking: 'off', reference: null}),
        ]),
      );
      for (const choice of fix?.models ?? []) {
        expect(choice).not.toHaveProperty('below_reference');
      }
    } finally {
      await client.close();
    }
  });

  test('lists every combination for a placeholder without a tested reference', async ({
    request,
    auth,
  }) => {
    const {client, workspaceId} = await connectAgentAccessClient({request, auth});
    try {
      const {project} = await createGithubProject(workspaceId);

      const template = await callToolResult(
        client,
        {
          name: 'get_workflow_template',
          arguments: {template_id: 'fix-dependency-ci', project_id: project.id},
        },
        getWorkflowTemplateResultSchema,
      );

      const fix = template.suggested_models.fix;
      expect(fix).toMatchObject({outcome: 'list', reference: null});
      expect(fix?.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({id: 'e2e-renewable-pi', thinking: 'off', reference: null}),
          expect.objectContaining({
            id: 'e2e-scored-efficient',
            thinking: 'medium',
            reference: expect.objectContaining({intelligence_index: 72}),
          }),
        ]),
      );
      for (const choice of fix?.models ?? []) {
        expect(choice).not.toHaveProperty('below_reference');
      }
    } finally {
      await client.close();
    }
  });

  test('does not serve another workspace project or a fixture template', async ({
    request,
    auth,
  }) => {
    const {client, workspaceId} = await connectAgentAccessClient({request, auth});
    try {
      const otherUser = await auth.createUser();
      const otherWorkspace = await createWorkspace({
        userId: otherUser.user.id,
        userEmail: otherUser.email,
      });
      const {project} = await createGithubProject(workspaceId);
      const {project: otherProject} = await createGithubProject(otherWorkspace.id);

      const crossWorkspace = await callToolEnvelope(client, {
        name: 'get_workflow_template',
        arguments: {template_id: 'fix-dependency-ci', project_id: otherProject.id},
      });
      const fixture = await callToolEnvelope(client, {
        name: 'get_workflow_template',
        arguments: {template_id: 'fixture-ticket-to-pr', project_id: project.id, tracker: 'linear'},
      });

      expect(crossWorkspace).toEqual({
        ok: false,
        error: {
          code: 'not-found',
          message: 'Unknown project_id. Call list_projects for project IDs.',
        },
      });
      expect(fixture).toEqual({
        ok: false,
        error: {
          code: 'not-found',
          message:
            'Unknown template_id "fixture-ticket-to-pr". Call list_workflow_templates for template IDs.',
        },
      });
    } finally {
      await client.close();
    }
  });
});
