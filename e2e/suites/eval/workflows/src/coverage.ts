import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TemplateLoader, WorkflowTemplate} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import type {DiscoveredCase} from './discovery.js';
import {CaseValidationError, formatValidationIssues} from './schema.js';

const behaviorsSchema = z
  .object({
    cases: z.array(z.object({case: z.string().min(1), proves: z.string().min(1)}).strict()).min(1),
  })
  .strict();

export type TemplateBehaviors = z.infer<typeof behaviorsSchema>;

export interface TemplateCoverage {
  /** Claims and behaviors the scripted cases do not back. Any entry fails the run. */
  problems: string[];
  /** Templates with no `behaviors.yaml` yet. They are reported, not failed. */
  pending: string[];
}

async function loadBehaviors(path: string): Promise<TemplateBehaviors | undefined> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseValidationError(path, `could not parse YAML: ${message}`);
  }
  const result = behaviorsSchema.safeParse(document);
  if (!result.success) throw new CaseValidationError(path, formatValidationIssues(result.error));
  return result.data;
}

function templateProblems({
  template,
  behaviors,
  cases,
}: {
  template: WorkflowTemplate;
  behaviors: TemplateBehaviors;
  cases: readonly DiscoveredCase[];
}): string[] {
  const templateCases = cases.filter(
    (entry) =>
      entry.definition.template === template.package && entry.definition.modes.includes('scripted'),
  );
  const cited = new Set(templateCases.flatMap((entry) => entry.definition.covers));
  const problems = template.manifest.writes
    .filter(({action}) => !cited.has(action))
    .map(({action}) => `${template.id}: no scripted case lists the write "${action}" in covers`);

  const scriptedIds = new Set(templateCases.map((entry) => entry.id));
  for (const {case: name} of behaviors.cases) {
    const id = `${template.id}/${name}`;
    if (scriptedIds.has(id)) continue;
    problems.push(
      cases.some((entry) => entry.id === id)
        ? `${template.id}: required case "${name}" exists but is not a scripted case of ${template.package}`
        : `${template.id}: required case "${name}" does not exist`,
    );
  }
  return problems;
}

/**
 * Checks that the scripted cases back what each shipped template promises. A cited claim is not a
 * proven one, because the case's strict `expect.writes` does that. This check only keeps a claim
 * from losing its case, and a case from losing its place in the template's required behaviors.
 */
export async function checkTemplateCoverage({
  casesRoot,
  loader,
  cases,
}: {
  casesRoot: string;
  loader: TemplateLoader;
  cases: readonly DiscoveredCase[];
}): Promise<TemplateCoverage> {
  const coverage: TemplateCoverage = {problems: [], pending: []};
  for (const template of await loader.list()) {
    const behaviors = await loadBehaviors(join(casesRoot, template.id, 'behaviors.yaml'));
    if (behaviors === undefined) {
      coverage.pending.push(template.id);
      continue;
    }
    coverage.problems.push(...templateProblems({template, behaviors, cases}));
  }
  return coverage;
}
