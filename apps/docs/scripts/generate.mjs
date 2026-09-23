#!/usr/bin/env node
import {randomUUID} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  AGENT_ACCESS_ACTION_TOOL_CALL_LIMIT,
  AGENT_ACCESS_TOOL_CALL_LIMIT,
  AGENT_ACCESS_TOOL_CALL_WINDOW_MS,
  createAgentAccessActionTools,
  createAgentAccessAuthoringContextTools,
  createAgentAccessDiagnosticTools,
  createAgentAccessIntegrationTools,
  createAgentAccessLogTools,
  createAgentAccessTemplateTools,
  createAgentAccessTools,
  createAgentAccessWorkflowDiagnosticTools,
} from '@shipfox/api-agent-access';
import {
  AGENT_ACCESS_ANNOTATION_BODY_MAX_BYTES,
  AGENT_ACCESS_DEFAULT_PAGE_LIMIT,
  AGENT_ACCESS_FACET_MAX_ITEMS,
  AGENT_ACCESS_FACET_VALUE_MAX_BYTES,
  AGENT_ACCESS_LOG_CONTENT_MAX_BYTES,
  AGENT_ACCESS_LOG_SECTION_MAX_ITEMS,
  AGENT_ACCESS_LOG_TAIL_LINES_DEFAULT,
  AGENT_ACCESS_LOG_TAIL_LINES_MAX,
  AGENT_ACCESS_PAGE_LIMIT_MAX,
  AGENT_ACCESS_RESPONSE_MAX_BYTES,
  AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES,
  AGENT_ACCESS_TEXT_MAX_BYTES,
  AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS,
  AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS,
  AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES,
  AGENT_ACCESS_WORKFLOW_SOURCE_MAX_BYTES,
} from '@shipfox/api-agent-access-dto';
import {listHarnessDescriptors, MODEL_PROVIDER_CATALOG_SEED} from '@shipfox/api-agent-dto';
import {
  clickupAgentToolCatalog,
  clickupAgentToolSelectionCatalog,
} from '@shipfox/api-integration-clickup/agent-tools';
import {clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
} from '@shipfox/api-integration-github/agent-tools';
import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {
  jiraAgentToolCatalog,
  jiraAgentToolSelectionCatalog,
} from '@shipfox/api-integration-jira/agent-tools';
import {jiraEventCatalog} from '@shipfox/api-integration-jira-dto';
import {
  linearAgentToolCatalog,
  linearAgentToolSelectionCatalog,
} from '@shipfox/api-integration-linear/agent-tools';
import {linearEventCatalog} from '@shipfox/api-integration-linear-dto';
import {
  notionAgentToolCatalog,
  notionAgentToolSelectionCatalog,
} from '@shipfox/api-integration-notion/agent-tools';
import {notionEventCatalog} from '@shipfox/api-integration-notion-dto';
import {
  posthogAgentToolCatalog,
  posthogAgentToolSelectionCatalog,
} from '@shipfox/api-integration-posthog/agent-tools';
import {sentryEventCatalog} from '@shipfox/api-integration-sentry-dto';
import {
  shipfoxAgentToolCatalog,
  shipfoxAgentToolSelectionCatalog,
} from '@shipfox/api-integration-shipfox/agent-tools';
import {
  slackAgentToolCatalog,
  slackAgentToolSelectionCatalog,
} from '@shipfox/api-integration-slack/agent-tools';
import {slackEventCatalog} from '@shipfox/api-integration-slack-dto';
import {webhookEventCatalog} from '@shipfox/api-integration-webhook-dto';
import {
  buildTypedRootsEnvironment,
  contextRootsForField,
  getWorkflowContextTypeEnvironment,
  workflowContextDocs,
  workflowContextNames,
} from '@shipfox/expression';
import {buildWorkflowJsonSchema, parseWorkflowDocument} from '@shipfox/workflow-document';
import {load} from 'js-yaml';
import {buildEventReference} from '@/lib/event-reference/build';
import {GENERATED_MANIFEST_FILE} from '@/lib/generated-artifacts';
import {tableValue} from '@/lib/markdown';
import {registeredIntegrationProviders} from '@/lib/registered-integration-providers';
import {buildIntegrationToolReference, buildMcpToolReference} from '@/lib/tool-reference/build';
import {WORKFLOW_SCHEMA_DOCUMENT_FILE} from '@/lib/workflow-schema/document';
import {
  contextFieldRows,
  contextRootShape,
  WORKFLOW_FIELD_YAML_KEYS,
} from './lib/context-reference.mjs';
import {
  buildWorkflowSchemaDocument,
  renderWorkflowSchemaMarkdownMap,
  renderWorkflowSchemaMdx,
} from './lib/workflow-schema.mjs';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_SCHEMA_EXAMPLES_DIRECTORY = 'content/examples/workflow-schema';
const dtoCatalogBySlug = {
  clickup: {
    eventCatalog: clickupEventCatalog,
    toolCatalog: clickupAgentToolCatalog,
    toolSelectionCatalog: clickupAgentToolSelectionCatalog,
  },
  github: {
    eventCatalog: githubEventCatalog,
    toolCatalog: githubAgentToolCatalog,
    toolSelectionCatalog: githubAgentToolSelectionCatalog,
  },
  jira: {
    eventCatalog: jiraEventCatalog,
    toolCatalog: jiraAgentToolCatalog,
    toolSelectionCatalog: jiraAgentToolSelectionCatalog,
  },
  linear: {
    eventCatalog: linearEventCatalog,
    toolCatalog: linearAgentToolCatalog,
    toolSelectionCatalog: linearAgentToolSelectionCatalog,
  },
  notion: {
    eventCatalog: notionEventCatalog,
    toolCatalog: notionAgentToolCatalog,
    toolSelectionCatalog: notionAgentToolSelectionCatalog,
  },
  posthog: {
    toolCatalog: posthogAgentToolCatalog,
    toolSelectionCatalog: posthogAgentToolSelectionCatalog,
  },
  sentry: {
    eventCatalog: sentryEventCatalog,
  },
  shipfox: {
    toolCatalog: shipfoxAgentToolCatalog,
    toolSelectionCatalog: shipfoxAgentToolSelectionCatalog,
  },
  slack: {
    eventCatalog: slackEventCatalog,
    toolCatalog: slackAgentToolCatalog,
    toolSelectionCatalog: slackAgentToolSelectionCatalog,
  },
  webhooks: {
    eventCatalog: webhookEventCatalog,
  },
};
const integrationCatalogProviders = registeredIntegrationProviders
  .filter((provider) => provider.kind === 'catalog')
  .map((provider) => ({...provider, ...dtoCatalogBySlug[provider.slug]}));
const regions = [
  {file: 'content/generated/reference/model-providers.mdx', render: renderModelProvidersTable},
  ...integrationCatalogProviders.flatMap((provider) => [
    ...(provider.eventCatalog
      ? [
          {
            file: `content/generated/integrations/${provider.slug}/events.json`,
            document: true,
            render: () => renderIntegrationEventReference(provider),
          },
        ]
      : []),
    ...(provider.toolCatalog
      ? [
          {
            file: `content/generated/integrations/${provider.slug}/tools.json`,
            document: true,
            render: () => renderIntegrationToolReference(provider),
          },
        ]
      : []),
  ]),
  {file: 'content/generated/integrations/catalog.json', render: renderIntegrationCatalogData},
  {
    file: 'content/generated/reference/workflow-schema.mdx',
    render: renderWorkflowSchemaArtifact,
    machineReadable: {
      format: 'json',
      file: 'content/generated/reference/workflow-schema.llm.json',
    },
  },
  {file: WORKFLOW_SCHEMA_DOCUMENT_FILE, document: true, render: renderWorkflowSchemaData},
  {file: 'content/generated/reference/context-roots.mdx', render: renderContextRoots},
  {
    file: 'content/generated/reference/context-availability.mdx',
    render: renderContextAvailability,
  },
  {file: 'content/generated/reference/context-properties.mdx', render: renderContextProperties},
  {
    file: 'content/generated/reference/mcp-server-tools.json',
    document: true,
    render: renderMcpToolReference,
  },
  {file: 'content/generated/reference/mcp-server-limits.mdx', render: renderMcpToolLimits},
];

const contextShapeDeps = {
  getTypeEnvironment: getWorkflowContextTypeEnvironment,
  buildTypedRoots: buildTypedRootsEnvironment,
  contextNames: workflowContextNames,
};

function renderContextRoots() {
  return [
    '| Context | Holds |',
    '|---|---|',
    ...workflowContextDocs.map((doc) => `| \`${doc.root}\` | ${doc.summary} |`),
  ].join('\n');
}

function renderContextAvailability() {
  return [
    '| Workflow key | Available contexts |',
    '|---|---|',
    ...Object.entries(WORKFLOW_FIELD_YAML_KEYS).map(
      ([field, key]) =>
        `| \`${key}\` | ${contextRootsForField(field)
          .map((root) => `\`${root}\``)
          .join(', ')} |`,
    ),
  ].join('\n');
}

function renderContextProperties() {
  return workflowContextDocs.flatMap((doc) => renderContextRoot(doc)).join('\n');
}

function renderContextRoot(doc) {
  const lines = [`### \`${doc.root}\``, '', doc.summary, ''];
  if (doc.shapeNote !== undefined) lines.push(doc.shapeNote, '');

  const shape = contextRootShape(doc.root, contextShapeDeps);
  const rows = shape === undefined ? [] : contextFieldRows(shape, '', doc.collapse ?? []);
  if (rows.length === 0) return lines;

  const prefix = doc.propertyPrefix ?? `${doc.root}.`;
  lines.push('| Property | Type | Description |', '|---|---|---|');
  for (const row of rows) {
    const description = doc.fields?.[row.path];
    if (description === undefined) {
      throw new Error(`Context ${doc.root} property ${row.path} has no description.`);
    }
    lines.push(`| \`${prefix}${row.path}\` | \`${row.type}\` | ${description} |`);
  }
  lines.push('');
  return lines;
}

function renderIntegrationCatalogData() {
  return JSON.stringify(
    Object.fromEntries(
      integrationCatalogProviders.map((provider) => [
        provider.slug,
        {
          capabilities: provider.capabilities,
          eventCount: provider.eventCatalog?.events.length ?? 0,
          toolCount: provider.toolCatalog?.length ?? 0,
        },
      ]),
    ),
    null,
    2,
  );
}

function renderModelProvidersTable() {
  const supported = MODEL_PROVIDER_CATALOG_SEED.filter((p) => p.support_status === 'supported');
  const harnesses = listHarnessDescriptors();
  return [
    '| Provider | `provider` ID | Default model | Compatible harnesses |',
    '|---|---|---|---|',
    ...supported.map((provider) => {
      const compatible = harnesses
        .filter((harness) => harness.supportedProviderIds.includes(provider.id))
        .map((harness) => `\`${harness.id}\``)
        .join(', ');
      return `| ${provider.label} | \`${provider.id}\` | \`${provider.default_model}\` | ${compatible} |`;
    }),
  ].join('\n');
}

// Event reference documents feed the EventReference component, the page TOC,
// and the machine-readable text. Trigger fragments use a sample connection slug;
// the custom webhook subscribes to its source without naming an event.
const eventReferenceSamples = {
  webhooks: {connection: 'deploy_hook', trigger: {key: 'on_webhook', omitEvent: true}},
};

function renderIntegrationEventReference(provider) {
  const sample = eventReferenceSamples[provider.slug] ?? {connection: `${provider.slug}_acme`};
  const document = buildEventReference({
    id: `integrations/${provider.slug}/events`,
    catalog: provider.eventCatalog,
    ...sample,
  });
  return JSON.stringify(document, null, 2);
}

// Tool reference documents feed the ToolReference component, the page TOC, and
// the machine-readable text. Examples use a sample connection slug per provider.
function renderIntegrationToolReference(provider) {
  const document = buildIntegrationToolReference({
    id: `integrations/${provider.slug}/tools`,
    catalog: provider.toolCatalog,
    selectors: provider.toolSelectionCatalog.selectors,
    connection: provider.slug === 'shipfox' ? 'shipfox' : `${provider.slug}_acme`,
    replaceConnection: provider.slug !== 'shipfox',
  });
  return JSON.stringify(document, generatedDocumentReplacer, 2);
}

function generatedDocumentReplacer(_key, value) {
  return typeof value === 'string' ? value.replaceAll(/[ \t]*\u2014[ \t]*/g, ': ') : value;
}

function renderMcpToolReference() {
  const tools = new Map(listMcpTools().map((tool) => [tool.name, tool]));
  const grouped = new Set(mcpToolGroups.flatMap((group) => group.tools));
  const ungrouped = [...tools.keys()].filter((name) => !grouped.has(name));
  if (ungrouped.length > 0) {
    throw new Error(`MCP tools missing from the documentation groups: ${ungrouped.join(', ')}`);
  }
  const document = buildMcpToolReference({
    id: 'reference/mcp-server-tools',
    groups: mcpToolGroups.map((group) => ({
      title: group.title,
      tools: group.tools.map((name) => {
        const tool = tools.get(name);
        if (!tool) throw new Error(`MCP tool ${name} is documented but not registered.`);
        return tool;
      }),
    })),
  });
  return JSON.stringify(document, null, 2);
}

function renderWorkflowSchemaArtifact() {
  const document = workflowSchemaDocument();
  return {
    content: renderWorkflowSchemaMdx(document),
    machineReadable: renderWorkflowSchemaMarkdownMap(document),
  };
}

function renderWorkflowSchemaData() {
  return JSON.stringify(workflowSchemaDocument(), null, 2);
}

let cachedWorkflowSchemaDocument;
function workflowSchemaDocument() {
  cachedWorkflowSchemaDocument ??= buildWorkflowSchemaDocument({
    schema: buildWorkflowJsonSchema(),
    examples: readWorkflowSchemaExamples(),
    parseYaml: (code) => load(code),
    validate: parseWorkflowDocument,
  });
  return cachedWorkflowSchemaDocument;
}

function readWorkflowSchemaExamples() {
  const directory = join(docsRoot, WORKFLOW_SCHEMA_EXAMPLES_DIRECTORY);
  return Object.fromEntries(
    readdirSync(directory)
      .filter((file) => file.endsWith('.yml'))
      .map((file) => [file, readFileSync(join(directory, file), 'utf8')]),
  );
}

const mcpToolGroups = [
  {
    title: 'Discovery',
    tools: [
      'list_projects',
      'list_workflow_definitions',
      'list_workflow_runs',
      'list_integration_connections',
      'get_integration_connection_tools',
      'get_workflow_setup_guide',
      'list_workflow_templates',
      'get_workflow_template',
      'get_workflow_authoring_context',
    ],
  },
  {
    title: 'Workflow run traversal',
    tools: [
      'get_workflow_run',
      'list_workflow_run_attempts',
      'list_workflow_run_jobs',
      'get_workflow_job',
      'list_workflow_job_executions',
      'list_workflow_execution_steps',
      'list_workflow_step_attempts',
      'list_workflow_run_job_explanations',
    ],
  },
  {
    title: 'Workflow diagnostics',
    tools: [
      'get_workflow_run_source',
      'get_workflow_execution_context',
      'get_step_attempt',
      'get_run_annotations',
      'list_execution_trigger_events',
      'get_execution_trigger_event',
    ],
  },
  {
    title: 'Workflow actions',
    tools: ['cancel_workflow_run', 'rerun_workflow_run', 'fire_manual_trigger', 'create_dev_run'],
  },
  {title: 'Step logs', tools: ['get_step_logs', 'get_step_log_download']},
  {
    title: 'Trigger events',
    tools: ['list_trigger_events', 'get_trigger_event', 'get_trigger_event_facets'],
  },
];

function listMcpTools() {
  // The tool factories only capture producer clients for later calls, so inert
  // stubs are enough to read the registered names, descriptions, and schemas.
  const stub = {};
  return [
    ...createAgentAccessTools({
      projects: stub,
      definitions: stub,
      workflows: stub,
      annotations: stub,
      triggers: stub,
      integrations: stub,
    }),
    ...createAgentAccessActionTools({workflows: stub, triggers: stub}),
    ...createAgentAccessDiagnosticTools({triggers: stub}),
    ...createAgentAccessWorkflowDiagnosticTools(stub),
    ...createAgentAccessLogTools({
      auth: stub,
      apiPublicUrl: 'https://api.shipfox.io',
      logs: stub,
      workflows: stub,
    }),
    ...createAgentAccessIntegrationTools(stub),
    ...createAgentAccessTemplateTools({
      agent: stub,
      projects: stub,
      integrations: stub,
      templates: stub,
    }),
    ...createAgentAccessAuthoringContextTools({agent: stub, workflows: stub, secrets: stub}),
  ];
}

function formatNumber(value) {
  return value.toLocaleString('en-US');
}

function renderMcpToolLimits() {
  const kib = (bytes) => `${bytes / 1024} KiB`;
  const windowMinutes = AGENT_ACCESS_TOOL_CALL_WINDOW_MS / 60_000;
  const windowLabel = windowMinutes === 1 ? 'minute' : `${windowMinutes} minutes`;
  const rows = [
    [
      'Successful response',
      `${kib(AGENT_ACCESS_RESPONSE_MAX_BYTES)} of serialized \`structuredContent\``,
    ],
    [
      'Text field',
      `${AGENT_ACCESS_TEXT_MAX_BYTES} UTF-8 bytes unless a tool table states another limit`,
    ],
    [
      'Page size',
      `Default ${AGENT_ACCESS_DEFAULT_PAGE_LIMIT}, maximum ${AGENT_ACCESS_PAGE_LIMIT_MAX}. Some tools declare a smaller default in their input table.`,
    ],
    ['Annotation body', kib(AGENT_ACCESS_ANNOTATION_BODY_MAX_BYTES)],
    ['Workflow source snapshot', kib(AGENT_ACCESS_WORKFLOW_SOURCE_MAX_BYTES)],
    [
      'Structured workflow value',
      `${kib(AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES)} per value before it moves to \`oversized_fields\``,
    ],
    [
      'Trigger payload preview',
      `${kib(AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES)} of serialized JSON`,
    ],
    [
      'Trigger event detail collections',
      `${AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS} decisions and ${AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS} replays`,
    ],
    [
      'Trigger event facets',
      `${AGENT_ACCESS_FACET_MAX_ITEMS} values per facet, ${AGENT_ACCESS_FACET_VALUE_MAX_BYTES} UTF-8 bytes per value`,
    ],
    [
      'Step log content',
      `${kib(AGENT_ACCESS_LOG_CONTENT_MAX_BYTES)} per response, split evenly across sections`,
    ],
    [
      'Step log tail lines',
      `Default ${AGENT_ACCESS_LOG_TAIL_LINES_DEFAULT}, maximum ${formatNumber(AGENT_ACCESS_LOG_TAIL_LINES_MAX)}`,
    ],
    ['Failed-only log sections', `${AGENT_ACCESS_LOG_SECTION_MAX_ITEMS} step attempts`],
    [
      'Tool calls',
      `${AGENT_ACCESS_TOOL_CALL_LIMIT} per credential per ${windowLabel} on each API instance`,
    ],
    [
      'Action tool calls',
      `${AGENT_ACCESS_ACTION_TOOL_CALL_LIMIT} per credential per ${windowLabel} on each API instance, within the tool-call limit`,
    ],
  ];
  return [
    '| Limit | Value |',
    '|---|---|',
    ...rows.map(([limit, value]) => `| ${limit} | ${tableValue(value)} |`),
  ].join('\n');
}

for (const region of regions) {
  const path = join(docsRoot, region.file);
  const rendered = region.render();
  const content = typeof rendered === 'string' ? rendered : rendered.content;
  writeGeneratedFile(path, `${content}\n`);

  if (region.machineReadable) {
    if (typeof rendered === 'string' || !rendered.machineReadable) {
      throw new Error(`${region.file} did not return its machine-readable artifact.`);
    }
    writeGeneratedFile(
      join(docsRoot, region.machineReadable.file),
      `${JSON.stringify(rendered.machineReadable, null, 2)}\n`,
    );
  }

  // biome-ignore lint/suspicious/noConsole: CLI diagnostics
  console.log(`✓ wrote ${region.file}`);
}

writeGeneratedFile(
  join(docsRoot, GENERATED_MANIFEST_FILE),
  `${JSON.stringify(
    Object.fromEntries(
      regions
        .filter((region) => !region.document)
        .map((region) => [
          region.file,
          region.machineReadable
            ? {format: region.machineReadable.format, file: region.machineReadable.file}
            : {format: 'markdown'},
        ]),
    ),
    null,
    2,
  )}\n`,
);

function writeGeneratedFile(path, content) {
  mkdirSync(dirname(path), {recursive: true});
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content);
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}
