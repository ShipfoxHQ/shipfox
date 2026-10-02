import {clickupAgentToolSelectionCatalog} from '@shipfox/api-integration-clickup';
import {clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {discordAgentToolSelectionCatalog} from '@shipfox/api-integration-discord/agent-tools';
import {discordEventCatalog} from '@shipfox/api-integration-discord-dto';
import {githubAgentToolSelectionCatalog} from '@shipfox/api-integration-github';
import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {jiraAgentToolSelectionCatalog} from '@shipfox/api-integration-jira';
import {jiraEventCatalog} from '@shipfox/api-integration-jira-dto';
import {linearAgentToolSelectionCatalog} from '@shipfox/api-integration-linear';
import {linearEventCatalog} from '@shipfox/api-integration-linear-dto';
import {shipfoxAgentToolSelectionCatalog} from '@shipfox/api-integration-shipfox';
import {shipfoxEventCatalog} from '@shipfox/api-integration-shipfox-dto';
import {slackAgentToolSelectionCatalog} from '@shipfox/api-integration-slack';
import {slackEventCatalog} from '@shipfox/api-integration-slack-dto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  parseWorkflowDocument,
  type WorkflowDocument,
  type WorkflowDocumentJob,
} from '@shipfox/workflow-document';
import {
  composeTemplate,
  loadShippedTemplates,
  type TemplateRoleBindings,
  templateRoleBindings,
  type WorkflowTemplate,
  type WorkflowTemplateManifest,
} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';
import {type IntegrationCatalog, templateCatalogIssues} from './template-conformance.js';

interface ProviderCatalog {
  events: ReadonlySet<string>;
  tools: ReadonlySet<string>;
  writeTools: ReadonlySet<string>;
}

interface ConformanceResult {
  issues: string[];
  variantCount: number;
}

interface WorkflowVariant {
  label: string;
  workflow: string;
}

interface ParsedWorkflowVariant {
  document: WorkflowDocument;
  label: string;
  toolIds: ReadonlySet<string>;
}

interface ParsedWorkflowVariantResult {
  issues: string[];
  variant: ParsedWorkflowVariant | null;
}

interface StructuralOptionMarker {
  boundary: 'begin' | 'end';
  choiceId: string;
  optionId: string;
}

interface StructuralOptionBlock extends StructuralOptionMarker {
  selected: boolean;
}

const structuralOptionMarkerPattern =
  /^\s*#\s*option:([a-z0-9_-]+)=([a-z0-9_-]+)\s+(begin|end)\s*$/;
const modelLinePattern = /^\s*model\s*:/;
const modelMarkerPattern = /^\s*model\s*:\s*[^#\r\n]+\s+#\s*model:([a-z0-9_-]+)\s*$/;

const providerCatalogs: Readonly<Record<string, ProviderCatalog>> = {
  clickup: catalog(clickupEventCatalog.events, clickupAgentToolSelectionCatalog.selectors),
  discord: catalog(discordEventCatalog.events, discordAgentToolSelectionCatalog.selectors),
  github: catalog(githubEventCatalog.events, githubAgentToolSelectionCatalog.selectors),
  jira: catalog(jiraEventCatalog.events, jiraAgentToolSelectionCatalog.selectors),
  linear: catalog(linearEventCatalog.events, linearAgentToolSelectionCatalog.selectors),
  shipfox: catalog(shipfoxEventCatalog.events, shipfoxAgentToolSelectionCatalog.selectors),
  slack: catalog(slackEventCatalog.events, slackAgentToolSelectionCatalog.selectors),
};

const integrationCatalog: IntegrationCatalog = {
  providers: new Map(Object.entries(providerCatalogs)),
  builtinConnections: new Map([['shipfox', 'shipfox']]),
};

describe('workflow template catalog conformance', () => {
  it('uses valid catalogs and produces structurally sound workflow variants', () => {
    const templates = loadShippedTemplates();
    const results = templates.map(templateConformance);
    const variantCount = results.reduce((total, result) => total + result.variantCount, 0);
    const issues = results.flatMap((result) => result.issues);

    expect(templates.length).toBeGreaterThan(0);
    expect(variantCount).toBeGreaterThan(templates.length);
    expect(issues).toEqual([]);
  });

  it('reports references and write selectors left behind by removed structure', () => {
    const document = parseWorkflowDocument(
      parseYaml(
        [
          'name: Invalid structural option fixture',
          'jobs:',
          '  deploy:',
          '    needs: build',
          '    steps:',
          '      - key: notify',
          '        model: test-model',
          '        prompt: $' + '{{ steps.prepare.outputs.body }}',
          '        integrations:',
          '          - include: [add_issue_comment]',
          '      - key: verify',
          '        run: echo ok',
          '        gate:',
          '          on_failure:',
          '            restart_from: prepare',
        ].join('\n'),
      ),
    );

    const issues = workflowVariantIssues(document, new Set(['add_issue_comment']), 'fixture');

    expect(issues).toHaveLength(4);
    expect(issues).toEqual(
      expect.arrayContaining([
        'fixture/deploy: needs unknown job build',
        'fixture/deploy: output expression references unknown step prepare',
        'fixture/deploy: restart_from references unknown step prepare',
        'fixture: write tool add_issue_comment remains after its tool step was removed',
      ]),
    );
  });

  it('checks catalog references in every composed variant', () => {
    const template = loadShippedTemplates().find(({id}) => id === 'report-failed-runs');
    if (template === undefined) throw new Error('Failed run report template was not loaded');

    const unknownTool = {
      ...template,
      workflow: template.workflow.replace('tool: get_workflow_run', 'tool: get_workflow_runs'),
    };
    const unknownEvent = {
      ...template,
      workflow: template.workflow.replace('event: run.completed', 'event: run.finished'),
    };
    const otherConnection = {
      ...template,
      workflow: template.workflow.replace('connection: shipfox', 'connection: other'),
    };

    expect(templateConformance(template).issues).toEqual([]);
    expect(templateConformance(unknownTool).issues).toContain(
      'report-failed-runs/notify=slack/default: shipfox (shipfox): unknown tool get_workflow_runs',
    );
    expect(templateConformance(unknownEvent).issues).toContain(
      'report-failed-runs/notify=slack/default: shipfox (shipfox): unknown event run.finished',
    );
    expect(templateConformance(otherConnection).issues).toContain(
      'report-failed-runs/notify=slack/default: tool get_workflow_run uses connection other, which is not bound to a role',
    );
  });

  it('requires matching model markers on model lines in provider parts', () => {
    const template = dependencyCiTemplate();
    const fix = template.parts.source?.github?.fix;
    if (fix === undefined) throw new Error('Fix part was not loaded');

    const missingMarker = {
      ...template,
      parts: {
        source: {github: {...template.parts.source?.github, fix: fix.replace('# model:fix', '')}},
      },
    };
    const unknownMarker = {
      ...template,
      parts: {
        source: {
          github: {
            ...template.parts.source?.github,
            fix: fix.replace('# model:fix', '# model:unknown'),
          },
        },
      },
    };

    expect(modelPlaceholderIssues(missingMarker)).toEqual(
      expect.arrayContaining([
        'fix-dependency-ci/source/github/fix: model line has no # model:<key> marker',
        'fix-dependency-ci: models.fix has no # model:fix marker',
      ]),
    );
    expect(modelPlaceholderIssues(unknownMarker)).toContain(
      'fix-dependency-ci/source/github/fix: # model:unknown has no manifest entry',
    );

    const baseModel = {
      ...template,
      workflow: `${template.workflow}\nmodel: replace-me # model:fix\n`,
    };
    expect(modelPlaceholderIssues(baseModel)).toEqual([]);
  });
});

function dependencyCiTemplate(): WorkflowTemplate {
  const template = loadShippedTemplates().find(({id}) => id === 'fix-dependency-ci');
  if (template === undefined) throw new Error('Shipped template was not loaded');
  return template;
}

function templateConformance(template: WorkflowTemplate): ConformanceResult {
  const results = templateRoleBindings(template.manifest.roles).map((bindings) =>
    bindingVariantsConformance(template, bindings),
  );

  return {
    issues: [...modelPlaceholderIssues(template), ...results.flatMap((result) => result.issues)],
    variantCount: results.reduce((total, result) => total + result.variantCount, 0),
  };
}

function modelPlaceholderIssues(template: WorkflowTemplate): string[] {
  const {manifest} = template;
  const markers = new Set<string>();
  const issues = modelMarkerIssues(
    template.workflow,
    `${template.id}/workflow.yml`,
    manifest,
    markers,
  );

  for (const [role, providers] of Object.entries(template.parts)) {
    for (const [provider, blocks] of Object.entries(providers)) {
      for (const [part, block] of Object.entries(blocks)) {
        issues.push(
          ...modelMarkerIssues(
            block,
            `${template.id}/${role}/${provider}/${part}`,
            manifest,
            markers,
          ),
        );
      }
    }
  }

  for (const key of Object.keys(manifest.models)) {
    if (!markers.has(key))
      issues.push(`${template.id}: models.${key} has no # model:${key} marker`);
  }
  return issues;
}

function modelMarkerIssues(
  source: string,
  prefix: string,
  manifest: WorkflowTemplateManifest,
  markers: Set<string>,
): string[] {
  const issues: string[] = [];
  for (const line of source.split('\n')) {
    const marker = modelMarkerPattern.exec(line);
    if (marker !== null) {
      const key = marker[1];
      if (key === undefined) continue;
      markers.add(key);
      if (manifest.models[key] === undefined) {
        issues.push(`${prefix}: # model:${key} has no manifest entry`);
      }
    } else if (modelLinePattern.test(line)) {
      issues.push(`${prefix}: model line has no # model:<key> marker`);
    } else if (line.includes('# model:')) {
      issues.push(`${prefix}: # model:<key> must be on a model line`);
    }
  }
  return issues;
}

function bindingVariantsConformance(
  template: WorkflowTemplate,
  bindings: TemplateRoleBindings,
): ConformanceResult {
  const composed = composeTemplate(template, bindings);
  const bindingLabel = Object.entries(bindings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, provider]) => `${role}=${provider}`)
    .join(',');
  const prefix = `${template.id}/${bindingLabel}`;
  const variants = structuralVariants(template.manifest, composed);
  const parsedResults = variants.map((variant) => parseWorkflowVariant(variant, prefix));
  const parsedVariants = parsedResults.flatMap((result) =>
    result.variant === null ? [] : [result.variant],
  );
  const allToolIds = new Set(parsedVariants.flatMap((variant) => [...variant.toolIds]));
  const writeTools = writeToolsForBindings(bindings);
  const issues = [
    ...variants.flatMap(({label, workflow}) =>
      templateCatalogIssues({workflow, bindings, catalog: integrationCatalog}).map(
        (issue) => `${prefix}/${label}: ${issue}`,
      ),
    ),
    ...parsedResults.flatMap((result) => result.issues),
  ];

  for (const variant of parsedVariants) {
    const removedWriteTools = new Set(
      [...allToolIds].filter((tool) => writeTools.has(tool) && !variant.toolIds.has(tool)),
    );
    issues.push(
      ...workflowVariantIssues(variant.document, removedWriteTools, `${prefix}/${variant.label}`),
    );
  }

  return {issues, variantCount: parsedResults.length};
}

function structuralVariants(
  manifest: WorkflowTemplateManifest,
  workflow: string,
): WorkflowVariant[] {
  const structuralOptionIds = collectStructuralOptionIds(manifest, workflow);
  const defaults = new Map<string, string>();

  for (const optionId of structuralOptionIds) {
    const option = manifest.options.find((candidate) => candidate.id === optionId);
    if (option === undefined) throw new Error(`Unknown structural option: ${optionId}`);
    const defaultChoice = option.choices.find((choice) => choice.default === true);
    if (defaultChoice === undefined) {
      throw new Error(`Structural option ${optionId} has no default choice`);
    }
    defaults.set(optionId, defaultChoice.id);
  }

  const variants: WorkflowVariant[] = [
    {label: 'default', workflow: renderStructuralOptions(workflow, defaults)},
  ];
  for (const optionId of structuralOptionIds) {
    const option = manifest.options.find((candidate) => candidate.id === optionId);
    if (option === undefined) continue;
    const defaultChoice = defaults.get(optionId);
    for (const choice of option.choices) {
      if (choice.id === defaultChoice) continue;
      const selections = new Map(defaults);
      selections.set(optionId, choice.id);
      variants.push({
        label: `${optionId}=${choice.id}`,
        workflow: renderStructuralOptions(workflow, selections),
      });
    }
  }
  return variants;
}

function collectStructuralOptionIds(
  manifest: WorkflowTemplateManifest,
  workflow: string,
): ReadonlySet<string> {
  const choicesByOption = new Map(
    manifest.options.map((option) => [
      option.id,
      new Set(option.choices.map((choice) => choice.id)),
    ]),
  );
  const optionIds = new Set<string>();

  for (const line of workflow.split('\n')) {
    const marker = parseStructuralOptionMarker(line);
    if (marker === null) continue;
    if (!choicesByOption.get(marker.optionId)?.has(marker.choiceId)) {
      throw new Error(`Unknown structural option marker: ${marker.optionId}=${marker.choiceId}`);
    }
    optionIds.add(marker.optionId);
  }
  return optionIds;
}

function renderStructuralOptions(
  workflow: string,
  selections: ReadonlyMap<string, string>,
): string {
  const blocks: StructuralOptionBlock[] = [];
  const output: string[] = [];

  for (const line of workflow.split('\n')) {
    const marker = parseStructuralOptionMarker(line);
    if (marker !== null) {
      updateStructuralOptionBlocks(marker, selections, blocks);
      continue;
    }

    if (blocks.every((block) => block.selected)) output.push(line);
  }

  const openBlock = blocks.at(-1);
  if (openBlock !== undefined) {
    throw new Error(
      `Unmatched structural option marker: ${openBlock.optionId}=${openBlock.choiceId} begin`,
    );
  }
  return output.join('\n');
}

function parseStructuralOptionMarker(line: string): StructuralOptionMarker | null {
  const match = structuralOptionMarkerPattern.exec(line);
  if (match === null) return null;
  const optionId = match[1];
  const choiceId = match[2];
  const boundary = match[3];
  if (
    optionId === undefined ||
    choiceId === undefined ||
    (boundary !== 'begin' && boundary !== 'end')
  ) {
    return null;
  }
  return {optionId, choiceId, boundary};
}

function updateStructuralOptionBlocks(
  marker: StructuralOptionMarker,
  selections: ReadonlyMap<string, string>,
  blocks: StructuralOptionBlock[],
): void {
  if (marker.boundary === 'begin') {
    blocks.push({...marker, selected: selections.get(marker.optionId) === marker.choiceId});
    return;
  }

  const block = blocks.pop();
  if (block?.optionId !== marker.optionId || block.choiceId !== marker.choiceId) {
    throw new Error(
      `Unmatched structural option marker: ${marker.optionId}=${marker.choiceId} end`,
    );
  }
}

function parseWorkflowVariant(
  variant: WorkflowVariant,
  prefix: string,
): ParsedWorkflowVariantResult {
  try {
    const document = parseWorkflowDocument(parseYaml(variant.workflow));
    return {
      issues: [],
      variant: {document, label: variant.label, toolIds: collectToolStepIds(document)},
    };
  } catch (error) {
    return {
      issues: [
        `${prefix}/${variant.label}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      variant: null,
    };
  }
}

function workflowVariantIssues(
  document: WorkflowDocument,
  removedWriteTools: ReadonlySet<string>,
  prefix: string,
): string[] {
  const issues: string[] = [];
  const jobIds = new Set(Object.keys(document.jobs));

  for (const [jobId, job] of Object.entries(document.jobs)) {
    issues.push(...workflowJobIssues(job, jobId, jobIds, prefix));
  }

  issues.push(...orphanedWriteToolIssues(document, removedWriteTools, prefix));
  return [...new Set(issues)];
}

function workflowJobIssues(
  job: WorkflowDocumentJob,
  jobId: string,
  jobIds: ReadonlySet<string>,
  prefix: string,
): string[] {
  const jobPrefix = `${prefix}/${jobId}`;
  const needs = typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []);
  const issues = needs
    .filter((need) => !jobIds.has(need))
    .map((need) => `${jobPrefix}: needs unknown job ${need}`);
  const stepIds = new Set(job.steps.flatMap((step) => (step.key === undefined ? [] : [step.key])));

  issues.push(...outputReferenceIssues(job, stepIds, jobIds, needs, jobPrefix));
  for (const step of job.steps) {
    const restartFrom = step.gate?.on_failure?.restart_from;
    if (restartFrom !== undefined && !stepIds.has(restartFrom)) {
      issues.push(`${jobPrefix}: restart_from references unknown step ${restartFrom}`);
    }
  }
  return issues;
}

function outputReferenceIssues(
  job: WorkflowDocumentJob,
  stepIds: ReadonlySet<string>,
  jobIds: ReadonlySet<string>,
  needs: readonly string[],
  prefix: string,
): string[] {
  const issues: string[] = [];
  visitStrings(job, (value) => {
    issues.push(...stringOutputReferenceIssues(value, stepIds, jobIds, needs, prefix));
  });
  return issues;
}

function stringOutputReferenceIssues(
  value: string,
  stepIds: ReadonlySet<string>,
  jobIds: ReadonlySet<string>,
  needs: readonly string[],
  prefix: string,
): string[] {
  const issues: string[] = [];
  for (const match of value.matchAll(/\bsteps\.([A-Za-z0-9_-]+)\.outputs\b/g)) {
    const stepId = match[1];
    if (stepId !== undefined && !stepIds.has(stepId)) {
      issues.push(`${prefix}: output expression references unknown step ${stepId}`);
    }
  }
  for (const match of value.matchAll(/\bneeds\.([A-Za-z0-9_-]+)\.outputs\b/g)) {
    const need = match[1];
    if (need !== undefined && (!jobIds.has(need) || !needs.includes(need))) {
      issues.push(`${prefix}: output expression references unavailable job ${need}`);
    }
  }
  return issues;
}

function orphanedWriteToolIssues(
  document: WorkflowDocument,
  removedWriteTools: ReadonlySet<string>,
  prefix: string,
): string[] {
  return [...collectIntegrationTools(document)]
    .filter((tool) => removedWriteTools.has(tool))
    .map((tool) => `${prefix}: write tool ${tool} remains after its tool step was removed`);
}

function collectToolStepIds(document: WorkflowDocument): ReadonlySet<string> {
  return new Set(
    Object.values(document.jobs).flatMap((job) =>
      job.steps.flatMap((step) => (step.tool === undefined ? [] : [step.tool])),
    ),
  );
}

function collectIntegrationTools(document: WorkflowDocument): ReadonlySet<string> {
  return new Set(
    Object.values(document.jobs).flatMap((job) =>
      job.steps.flatMap((step) =>
        (step.integrations ?? []).flatMap((integration) => integration.include),
      ),
    ),
  );
}

function writeToolsForBindings(bindings: TemplateRoleBindings): ReadonlySet<string> {
  return new Set(
    [...Object.values(bindings), ...integrationCatalog.builtinConnections.values()].flatMap(
      (provider) => [...(providerCatalogs[provider]?.writeTools ?? [])],
    ),
  );
}

function catalog(
  events: readonly {name: string}[],
  selectors: readonly {sensitivity: 'read' | 'write'; token: string}[],
): ProviderCatalog {
  return {
    events: new Set(events.map((event) => event.name)),
    tools: new Set(selectors.map((selector) => selector.token)),
    writeTools: new Set(
      selectors
        .filter((selector) => selector.sensitivity === 'write')
        .map((selector) => selector.token),
    ),
  };
}

function visitStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitStrings(item, visit);
    return;
  }
  if (!isRecord(value)) return;
  for (const nested of Object.values(value)) visitStrings(nested, visit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
