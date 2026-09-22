import {clickupAgentToolSelectionCatalog} from '@shipfox/api-integration-clickup';
import {clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {githubAgentToolSelectionCatalog} from '@shipfox/api-integration-github';
import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {jiraAgentToolSelectionCatalog} from '@shipfox/api-integration-jira';
import {jiraEventCatalog} from '@shipfox/api-integration-jira-dto';
import {linearAgentToolSelectionCatalog} from '@shipfox/api-integration-linear';
import {linearEventCatalog} from '@shipfox/api-integration-linear-dto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {loadShippedTemplates, type WorkflowTemplate} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';

interface ProviderCatalog {
  events: ReadonlySet<string>;
  tools: ReadonlySet<string>;
}

interface CatalogReferences {
  events: string[];
  tools: string[];
}

interface ConformanceResult {
  issues: string[];
  referenceCount: number;
}

const providerCatalogs: Readonly<Record<string, ProviderCatalog>> = {
  clickup: catalog(clickupEventCatalog.events, clickupAgentToolSelectionCatalog.selectors),
  github: catalog(githubEventCatalog.events, githubAgentToolSelectionCatalog.selectors),
  jira: catalog(jiraEventCatalog.events, jiraAgentToolSelectionCatalog.selectors),
  linear: catalog(linearEventCatalog.events, linearAgentToolSelectionCatalog.selectors),
};

describe('workflow template catalog conformance', () => {
  it('uses only provider events and tools that exist in the catalogs', () => {
    const templates = loadShippedTemplates();
    const results = templates.map(templateConformance);
    const referenceCount = results.reduce((total, result) => total + result.referenceCount, 0);
    const issues = results.flatMap((result) => result.issues);

    expect(templates.length).toBeGreaterThan(0);
    expect(referenceCount).toBeGreaterThan(0);
    expect(issues).toEqual([]);
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

  return {
    issues: [...issues, ...partResults.flatMap((result) => result.issues)],
    referenceCount:
      templateReferenceCount +
      partResults.reduce((total, result) => total + result.referenceCount, 0),
  };
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
    };
  }

  const results = Object.entries(blocks).map(([part, block]) =>
    partConformance(templateId, role, provider, part, block, providerCatalog),
  );
  return {
    issues: results.flatMap((result) => result.issues),
    referenceCount: results.reduce((total, result) => total + result.referenceCount, 0),
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
  };
}

function referenceCount(references: CatalogReferences): number {
  return references.events.length + references.tools.length;
}

function catalog(
  events: readonly {name: string}[],
  selectors: readonly {token: string}[],
): ProviderCatalog {
  return {
    events: new Set(events.map((event) => event.name)),
    tools: new Set(selectors.map((selector) => selector.token)),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
