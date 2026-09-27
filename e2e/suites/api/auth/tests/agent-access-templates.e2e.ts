import {randomUUID} from 'node:crypto';
import {
  type GetWorkflowTemplateResultDto,
  getWorkflowTemplateResultSchema,
  listWorkflowTemplatesResultSchema,
  listWorkspaceModelsResultSchema,
  type ModelChoiceDto,
} from '@shipfox/api-agent-access-dto';
import {requestJson} from '@shipfox/e2e-core';
import {
  createGithubConnection,
  createLinearConnection,
  createSlackConnection,
} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {callToolEnvelope, callToolResult, connectAgentAccessClient} from './agent-access-client.js';
import {expect, test} from './test.js';

const SHIPPED_TEMPLATE_IDS = [
  'ask-codebase',
  'fix-default-branch-ci',
  'fix-dependency-ci',
  'report-failed-runs',
  'ticket-to-pr',
];
const E2E_MANAGED_PROVIDER = 'shipfox';
const MODEL_MARKER_RE = /^(\s*)model:\s*\S+\s+#\s*model:([a-z0-9_-]+)\s*$/u;
const AGENT_FIELD_RE = /^(\s*)(model|thinking|provider|harness):\s*(\S+)/u;
const LEADING_SPACES_RE = /^\s*/u;

type ChoiceBinding = Pick<
  ModelChoiceDto,
  'model' | 'provider' | 'harness' | 'thinking' | 'provider_required'
>;

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

async function createSlackNotifier(workspaceId: string) {
  const uniqueId = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  return await createSlackConnection({
    workspaceId,
    teamId: `T${uniqueId}`,
    teamName: `Templates E2E ${uniqueId}`,
    appId: `A${uniqueId}`,
    botUserId: `U${uniqueId}`,
    botToken: `xoxb-templates-e2e-${uniqueId}`,
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
      expect(before.templates.find(({id}) => id === 'fix-default-branch-ci')).toMatchObject({
        compatible: true,
        missing_providers: [],
        roles: expect.arrayContaining([
          expect.objectContaining({
            role: 'report',
            optional: true,
            providers: [{provider: 'slack', compatible: false, suggested_bindings: []}],
          }),
        ]),
      });
      expect(after.templates.find(({id}) => id === 'ticket-to-pr')).toMatchObject({
        compatible: true,
        missing_providers: [],
        roles: expect.arrayContaining([
          {
            role: 'tracker',
            from_project: false,
            optional: false,
            providers: [{provider: 'linear', compatible: true, suggested_bindings: [linear.slug]}],
          },
          {
            role: 'source',
            from_project: true,
            optional: false,
            providers: [{provider: 'github', compatible: true, suggested_bindings: [github.slug]}],
          },
        ]),
      });
    } finally {
      await client.close();
    }
  });

  test('recommends ticket to PR models that resolve to the chosen binding', async ({
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
      const models = await callToolResult(
        client,
        {
          name: 'list_workspace_models',
          arguments: {provider: E2E_MANAGED_PROVIDER, query: 'efficient', limit: 25},
        },
        listWorkspaceModelsResultSchema,
      );

      expect(template.suggested_bindings).toEqual({source: [github.slug], tracker: [linear.slug]});
      expect(() => parseWorkflowDocument(parseYaml(template.workflow_yaml))).not.toThrow();
      const fix = groupFor(template, 'fix');
      expect(fix).toMatchObject({
        mode: 'recommended',
        attribution: expect.any(String),
        cost_note: expect.any(String),
        choices: [
          {
            model: 'gpt-6-luna',
            provider: E2E_MANAGED_PROVIDER,
            thinking: 'high',
            provider_required: false,
            is_anchor: true,
            intelligence_index: 60,
            tradeoff: null,
          },
          {
            model: 'e2e-scored-efficient',
            lab: 'DeepSeek',
            thinking: 'medium',
            is_anchor: false,
            tradeoff: {intelligence: 'slightly_smarter', cost: 'more_expensive'},
          },
        ],
      });
      const reply = groupFor(template, 'reply');
      expect(reply).toMatchObject({
        mode: 'workspace_default',
        choices: [{model: 'e2e-renewable-pi', is_anchor: false, is_default: true}],
      });

      for (const choice of fix.choices) {
        await expectChoiceResolves({
          workspaceId,
          yaml: template.workflow_yaml,
          placeholder: 'fix',
          choice,
        });
      }
      await expectChoiceResolves({
        workspaceId,
        yaml: template.workflow_yaml,
        placeholder: 'reply',
        choice: onlyChoice(reply),
      });
      const [catalogPick] = models.models;
      if (catalogPick === undefined) throw new Error('Expected a catalog model');
      await expectChoiceResolves({
        workspaceId,
        yaml: template.workflow_yaml,
        placeholder: 'reply',
        choice: {
          ...catalogPick,
          model: catalogPick.id,
          thinking: 'medium',
          provider_required: false,
        },
        writeProvider: true,
      });
    } finally {
      await client.close();
    }
  });

  test('composes the failed run report without a project source binding', async ({
    request,
    auth,
  }) => {
    const {client, workspaceId} = await connectAgentAccessClient({request, auth});
    try {
      const {project} = await createGithubProject(workspaceId);

      const before = await callToolResult(
        client,
        {name: 'list_workflow_templates', arguments: {}},
        listWorkflowTemplatesResultSchema,
      );
      const slack = await createSlackNotifier(workspaceId);
      const template = await callToolResult(
        client,
        {
          name: 'get_workflow_template',
          arguments: {template_id: 'report-failed-runs', project_id: project.id, notify: 'slack'},
        },
        getWorkflowTemplateResultSchema,
      );

      expect(before.templates.find(({id}) => id === 'report-failed-runs')).toMatchObject({
        compatible: false,
        missing_providers: ['slack'],
      });
      expect(template.suggested_bindings).toEqual({notify: [slack.slug]});
      expect(template.workflow_yaml).toContain('source: shipfox');
      expect(() => parseWorkflowDocument(parseYaml(template.workflow_yaml))).not.toThrow();
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

function groupFor(template: GetWorkflowTemplateResultDto, placeholder: string) {
  const group = template.model_recommendations.find(({placeholders}) =>
    placeholders.includes(placeholder),
  );
  if (group === undefined) throw new Error(`Missing model group for ${placeholder}`);
  return group;
}

function onlyChoice(group: GetWorkflowTemplateResultDto['model_recommendations'][number]) {
  const [choice] = group.choices;
  if (choice === undefined || group.choices.length !== 1) throw new Error('Expected one choice');
  return choice;
}

/**
 * Binds the choice at every marker of the placeholder, as the template playbook
 * does, then resolves each marked step through the agent module.
 */
async function expectChoiceResolves(params: {
  workspaceId: string;
  yaml: string;
  placeholder: string;
  choice: ChoiceBinding;
  writeProvider?: boolean;
}) {
  const {choice} = params;
  const applied = applyModelChoice(params.yaml, params.placeholder, choice, params.writeProvider);
  const steps = markedStepConfigs(applied, params.placeholder);

  expect(steps.length).toBeGreaterThan(0);
  expect(steps).toHaveLength(markedStepConfigs(params.yaml, params.placeholder).length);
  expect(() => parseWorkflowDocument(parseYaml(applied))).not.toThrow();
  for (const config of steps) {
    const resolved = await requestJson('post', '/__e2e/agent/resolve-agent-config', {
      json: {workspace_id: params.workspaceId, config},
    });
    expect(resolved).toEqual({
      provider: choice.provider,
      harness: choice.harness,
      model: choice.model,
      thinking: choice.thinking,
    });
  }
}

function applyModelChoice(
  yaml: string,
  placeholder: string,
  choice: ChoiceBinding,
  writeProvider = false,
): string {
  const output: string[] = [];
  let indentation: string | undefined;
  for (const line of yaml.split('\n')) {
    const marker = MODEL_MARKER_RE.exec(line);
    if (marker?.[2] === placeholder) {
      indentation = marker[1] ?? '';
      output.push(`${indentation}model: ${choice.model} # model:${placeholder}`);
      if (choice.provider_required || writeProvider) {
        output.push(`${indentation}provider: ${choice.provider}`);
      }
      continue;
    }
    if (indentation !== undefined && leavesStep(line, indentation)) indentation = undefined;
    const field = AGENT_FIELD_RE.exec(line);
    if (indentation !== undefined && field?.[1] === indentation && field[2] === 'thinking') {
      output.push(`${indentation}thinking: ${choice.thinking}`);
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

function markedStepConfigs(yaml: string, placeholder: string): Record<string, string>[] {
  const configs: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;
  let indentation: string | undefined;
  for (const line of yaml.split('\n')) {
    const marker = MODEL_MARKER_RE.exec(line);
    if (marker?.[2] === placeholder) {
      indentation = marker[1] ?? '';
      current = {};
      configs.push(current);
    }
    if (indentation !== undefined && leavesStep(line, indentation)) {
      current = undefined;
      indentation = undefined;
    }
    const [, fieldIndentation, key, value] = AGENT_FIELD_RE.exec(line) ?? [];
    if (current !== undefined && fieldIndentation === indentation && key !== undefined) {
      current[key] = value ?? '';
    }
  }
  return configs;
}

function leavesStep(line: string, indentation: string): boolean {
  if (line.trim() === '') return false;
  return (LEADING_SPACES_RE.exec(line)?.[0].length ?? 0) < indentation.length;
}
