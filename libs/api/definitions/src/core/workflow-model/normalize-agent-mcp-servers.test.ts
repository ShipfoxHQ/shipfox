import type {WorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {
  InvalidWorkflowModelError,
  type WorkflowModelValidationIssue,
} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

type DocumentStep = WorkflowDocument['jobs'][string]['steps'][number];

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function normalizeAgentStep(step: Partial<DocumentStep>) {
  const diagnostics: WorkflowModelValidationIssue[] = [];
  const model = normalizeWorkflowDocument(
    {
      name: 'MCP workflow',
      runner: 'ubuntu-latest',
      jobs: {investigate: {steps: [{prompt: 'Find slow queries.', ...step} as DocumentStep]}},
    },
    {agentValidationCatalog, diagnostics},
  );
  const normalized = model.jobs[0]?.steps[0];
  if (normalized?.kind !== 'agent') return expect.fail('Expected an agent step');
  return {step: normalized, diagnostics};
}

function agentStepIssues(step: Partial<DocumentStep>) {
  try {
    normalizeAgentStep(step);
  } catch (error) {
    if (error instanceof InvalidWorkflowModelError) return error.issues;
    throw error;
  }
  return expect.fail('Expected InvalidWorkflowModelError');
}

describe('normalizeAgentMcpServers', () => {
  it('keeps the literal command and args and a template for each interpolated env value', () => {
    const connection = interpolation('secrets.MONGO_URI');

    const {step, diagnostics} = normalizeAgentStep({
      mcp_servers: {
        mongodb: {
          command: 'npx',
          args: ['-y', 'mongodb-mcp-server@1.2.0'],
          env: {MDB_MCP_CONNECTION_STRING: connection, MDB_MCP_READ_ONLY: true},
          include: ['find', 'find', 'aggregate'],
        },
      },
    });

    expect(diagnostics).toEqual([]);
    expect(step.customMcpServers).toEqual([
      {
        name: 'mongodb',
        command: 'npx',
        args: ['-y', 'mongodb-mcp-server@1.2.0'],
        env: {MDB_MCP_CONNECTION_STRING: connection, MDB_MCP_READ_ONLY: 'true'},
        include: ['find', 'aggregate'],
        templates: {
          env: {
            MDB_MCP_CONNECTION_STRING: [
              expect.objectContaining({kind: 'deferred', roots: ['secrets']}),
            ],
          },
        },
      },
    ]);
  });

  it('rejects a server with the tool prefix of an integration connection', () => {
    const issues = agentStepIssues({
      integrations: [{connection: 'my-db', include: ['issue_read']}],
      mcp_servers: {my_db: {command: 'db-mcp'}},
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'agent-mcp-server-name-collision',
        path: ['jobs', 'investigate', 'steps', 0, 'mcp_servers', 'my_db'],
      }),
    );
  });

  it('reports malformed interpolation in an env value', () => {
    const issues = agentStepIssues({
      mcp_servers: {db: {command: 'db-mcp', env: {BROKEN: '$'.concat('{{ vars.X')}}},
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      ['jobs', 'investigate', 'steps', 0, 'mcp_servers', 'db', 'env', 'BROKEN'],
    ]);
  });
});
