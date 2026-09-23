import {getModels} from '@earendil-works/pi-ai/compat';
import {
  type AgentThinking,
  agentThinkingByHarness,
  CLAUDE_MODEL_LINE,
  SUPPORTED_MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import {clickupAgentToolSelectionCatalog} from '@shipfox/api-integration-clickup';
import {clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {githubAgentToolSelectionCatalog} from '@shipfox/api-integration-github';
import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {jiraAgentToolSelectionCatalog} from '@shipfox/api-integration-jira';
import {jiraEventCatalog} from '@shipfox/api-integration-jira-dto';
import {linearAgentToolSelectionCatalog} from '@shipfox/api-integration-linear';
import {linearEventCatalog} from '@shipfox/api-integration-linear-dto';
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
  type WorkflowTemplate,
  type WorkflowTemplateManifest,
} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';

interface ProviderCatalog {
  events: ReadonlySet<string>;
  tools: ReadonlySet<string>;
  writeTools: ReadonlySet<string>;
}

interface CatalogReferences {
  events: string[];
  tools: string[];
}

interface ConformanceResult {
  issues: string[];
  referenceCount: number;
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
const builtInModelThinking = createBuiltInModelThinking();

const providerCatalogs: Readonly<Record<string, ProviderCatalog>> = {
  clickup: catalog(clickupEventCatalog.events, clickupAgentToolSelectionCatalog.selectors),
  github: catalog(githubEventCatalog.events, githubAgentToolSelectionCatalog.selectors),
  jira: catalog(jiraEventCatalog.events, jiraAgentToolSelectionCatalog.selectors),
  linear: catalog(linearEventCatalog.events, linearAgentToolSelectionCatalog.selectors),
};

describe('workflow template catalog conformance', () => {
  it('uses valid catalogs and produces structurally sound workflow variants', () => {
    const templates = loadShippedTemplates();
    const results = templates.map(templateConformance);
    const referenceCount = results.reduce((total, result) => total + result.referenceCount, 0);
    const variantCount = results.reduce((total, result) => total + result.variantCount, 0);
    const issues = results.flatMap((result) => result.issues);

    expect(templates.length).toBeGreaterThan(0);
    expect(referenceCount).toBeGreaterThan(0);
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

  it('requires matching model markers on model lines in provider parts', () => {
    const template = loadShippedTemplates()[0];
    if (template === undefined) throw new Error('Shipped template was not loaded');
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

  it('rejects unknown reference models and unsupported thinking levels', () => {
    const template = loadShippedTemplates()[0];
    if (template === undefined) throw new Error('Shipped template was not loaded');
    const models = new Map<string, ReadonlySet<AgentThinking>>([
      ['known-model', new Set<AgentThinking>(['off'])],
    ]);

    const unknownModel = {
      ...template,
      manifest: {
        ...template.manifest,
        models: {fix: {reference: {model: 'missing-model', thinking: 'off' as const}}},
      },
    };
    const unsupportedThinking = {
      ...template,
      manifest: {
        ...template.manifest,
        models: {fix: {reference: {model: 'known-model', thinking: 'high' as const}}},
      },
    };

    expect(modelPlaceholderIssues(unknownModel, models)).toContain(
      'fix-dependency-ci: models.fix references unknown built-in model missing-model',
    );
    expect(modelPlaceholderIssues(unsupportedThinking, models)).toContain(
      'fix-dependency-ci: models.fix references unsupported thinking high for known-model',
    );
    expect(modelPlaceholderIssues(template, models)).toEqual([]);
    expect(
      modelPlaceholderIssues({
        ...template,
        manifest: {
          ...template.manifest,
          models: {fix: {reference: {model: 'claude-sonnet-5', thinking: 'high'}}},
        },
      }),
    ).toEqual([]);
  });
});

function templateConformance(template: WorkflowTemplate): ConformanceResult {
  const templateReferences = collectCatalogReferences(parseYaml(template.workflow));
  const templateReferenceCount = referenceCount(templateReferences);
  const issues =
    templateReferenceCount === 0
      ? []
      : [
          `${template.manifest.id}/workflow.yml contains provider references outside a provider part`,
        ];
  const partResults = Object.entries(template.parts).flatMap(([role, providers]) =>
    Object.entries(providers).map(([provider, blocks]) =>
      providerPartsConformance(template.manifest.id, role, provider, blocks),
    ),
  );
  const variantsResult = templateVariantsConformance(template);

  return {
    issues: [
      ...issues,
      ...modelPlaceholderIssues(template),
      ...partResults.flatMap((result) => result.issues),
      ...variantsResult.issues,
    ],
    referenceCount:
      templateReferenceCount +
      partResults.reduce((total, result) => total + result.referenceCount, 0),
    variantCount: variantsResult.variantCount,
  };
}

function modelPlaceholderIssues(
  template: WorkflowTemplate,
  catalog: ReadonlyMap<string, ReadonlySet<AgentThinking>> = builtInModelThinking,
): string[] {
  const {manifest} = template;
  const markers = new Set<string>();
  const issues = modelMarkerIssues(
    template.workflow,
    `${manifest.id}/workflow.yml`,
    manifest,
    markers,
  );

  for (const [role, providers] of Object.entries(template.parts)) {
    for (const [provider, blocks] of Object.entries(providers)) {
      for (const [part, block] of Object.entries(blocks)) {
        issues.push(
          ...modelMarkerIssues(
            block,
            `${manifest.id}/${role}/${provider}/${part}`,
            manifest,
            markers,
          ),
        );
      }
    }
  }

  for (const [key, {reference}] of Object.entries(manifest.models)) {
    if (!markers.has(key))
      issues.push(`${manifest.id}: models.${key} has no # model:${key} marker`);
    if (reference === undefined) continue;
    const supportedThinking = catalog.get(reference.model);
    if (supportedThinking === undefined) {
      issues.push(
        `${manifest.id}: models.${key} references unknown built-in model ${reference.model}`,
      );
    } else if (!supportedThinking.has(reference.thinking)) {
      issues.push(
        `${manifest.id}: models.${key} references unsupported thinking ${reference.thinking} for ${reference.model}`,
      );
    }
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

function createBuiltInModelThinking(): ReadonlyMap<string, ReadonlySet<AgentThinking>> {
  const catalog = new Map<string, Set<AgentThinking>>();
  const piLevels = agentThinkingByHarness.pi.options;

  for (const provider of SUPPORTED_MODEL_PROVIDER_IDS) {
    for (const model of getModels(provider as Parameters<typeof getModels>[0])) {
      const supported = piLevels.filter((level) =>
        level === 'default'
          ? model.reasoning === true
          : (model.reasoning || level === 'off') && model.thinkingLevelMap?.[level] !== null,
      );
      addModelThinking(catalog, model.id, supported);
    }
  }

  for (const model of CLAUDE_MODEL_LINE) {
    addModelThinking(catalog, model.id, agentThinkingByHarness.claude.options);
  }
  return catalog;
}

function addModelThinking(
  catalog: Map<string, Set<AgentThinking>>,
  modelId: string,
  supported: readonly AgentThinking[],
): void {
  const levels = catalog.get(modelId) ?? new Set<AgentThinking>();
  for (const level of supported) levels.add(level);
  catalog.set(modelId, levels);
}

function providerPartsConformance(
  templateId: string,
  role: string,
  provider: string,
  blocks: Readonly<Record<string, string>>,
): ConformanceResult {
  const providerCatalog = providerCatalogs[provider];
  if (providerCatalog === undefined) {
    return {
      issues: [`${templateId}/${role}/${provider} has no registered catalog`],
      referenceCount: 0,
      variantCount: 0,
    };
  }

  const results = Object.entries(blocks).map(([part, block]) =>
    partConformance(templateId, role, provider, part, block, providerCatalog),
  );
  return {
    issues: results.flatMap((result) => result.issues),
    referenceCount: results.reduce((total, result) => total + result.referenceCount, 0),
    variantCount: 0,
  };
}

function partConformance(
  templateId: string,
  role: string,
  provider: string,
  part: string,
  block: string,
  providerCatalog: ProviderCatalog,
): ConformanceResult {
  const references = collectCatalogReferences(parseYaml(block));
  const prefix = `${templateId}/${role}/${provider}/${part}`;
  return {
    issues: [
      ...references.events
        .filter((event) => !providerCatalog.events.has(event))
        .map((event) => `${prefix}: unknown event ${event}`),
      ...references.tools
        .filter((tool) => !providerCatalog.tools.has(tool))
        .map((tool) => `${prefix}: unknown tool ${tool}`),
    ],
    referenceCount: referenceCount(references),
    variantCount: 0,
  };
}

function templateVariantsConformance(template: WorkflowTemplate): ConformanceResult {
  const results = roleBindings(template.manifest.roles).map((bindings) =>
    bindingVariantsConformance(template, bindings),
  );

  return {
    issues: results.flatMap((result) => result.issues),
    referenceCount: 0,
    variantCount: results.reduce((total, result) => total + result.variantCount, 0),
  };
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
  const prefix = `${template.manifest.id}/${bindingLabel}`;
  const parsedResults = structuralVariants(template.manifest, composed).map((variant) =>
    parseWorkflowVariant(variant, prefix),
  );
  const parsedVariants = parsedResults.flatMap((result) =>
    result.variant === null ? [] : [result.variant],
  );
  const allToolIds = new Set(parsedVariants.flatMap((variant) => [...variant.toolIds]));
  const writeTools = writeToolsForBindings(bindings);
  const issues = parsedResults.flatMap((result) => result.issues);

  for (const variant of parsedVariants) {
    const removedWriteTools = new Set(
      [...allToolIds].filter((tool) => writeTools.has(tool) && !variant.toolIds.has(tool)),
    );
    issues.push(
      ...workflowVariantIssues(variant.document, removedWriteTools, `${prefix}/${variant.label}`),
    );
  }

  return {
    issues,
    referenceCount: 0,
    variantCount: parsedResults.length,
  };
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
    Object.values(bindings).flatMap((provider) => [
      ...(providerCatalogs[provider]?.writeTools ?? []),
    ]),
  );
}

function roleBindings(roles: WorkflowTemplateManifest['roles']): TemplateRoleBindings[] {
  return Object.entries(roles).reduce<TemplateRoleBindings[]>(
    (bindings, [role, declaration]) =>
      bindings.flatMap((binding) =>
        declaration.providers.map((provider) => ({...binding, [role]: provider})),
      ),
    [{}],
  );
}

function referenceCount(references: CatalogReferences): number {
  return references.events.length + references.tools.length;
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

function collectCatalogReferences(value: unknown): CatalogReferences {
  const references: CatalogReferences = {events: [], tools: []};
  visitCatalogReferences(value, references);
  return references;
}

function visitCatalogReferences(value: unknown, references: CatalogReferences): void {
  if (Array.isArray(value)) {
    for (const item of value) visitCatalogReferences(item, references);
    return;
  }
  if (!isRecord(value)) return;

  addEventReference(value, references);
  addToolReference(value, references);
  addIntegrationReferences(value, references);

  for (const nested of Object.values(value)) visitCatalogReferences(nested, references);
}

function addEventReference(value: Record<string, unknown>, references: CatalogReferences): void {
  if (typeof value.source === 'string' && typeof value.event === 'string') {
    references.events.push(value.event);
  }
}

function addToolReference(value: Record<string, unknown>, references: CatalogReferences): void {
  if (typeof value.tool === 'string') references.tools.push(value.tool);
}

function addIntegrationReferences(
  value: Record<string, unknown>,
  references: CatalogReferences,
): void {
  if (!Array.isArray(value.integrations)) return;

  for (const integration of value.integrations) {
    if (!isRecord(integration) || !Array.isArray(integration.include)) continue;
    references.tools.push(
      ...integration.include.filter((tool): tool is string => typeof tool === 'string'),
    );
  }
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
