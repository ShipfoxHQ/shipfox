import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {RUN_ISSUE_LOCATIONS_MAX, type RunIssue} from '@shipfox/api-workflows-dto/inter-module';
import {
  collectRunRequirements,
  type ReferencedSecret,
  type ReferencedVariable,
  variableReferenceIsRequired,
} from './run-requirements.js';

type RunIssueEffect = RunIssue['effect'];
type RunIssueLocation = RunIssue['locations'][number];
type RunIssueStep = NonNullable<RunIssueLocation['step']>;

export interface KeyLocations {
  readonly key: string;
  readonly locations: RunIssueLocation[];
  readonly moreLocations?: number;
}

/**
 * Report the variables a workflow reads that are not defined, with the effect each one has
 * when a run happens. The effect is found by replaying the collector calls the two resolution
 * phases make, so it cannot drift from what they do:
 *
 * - `createWorkflowRun` reads predicates from every job and templates from the jobs that are
 *   not listening. A missing variable there refuses the start.
 * - Creating a listening job's execution reads that job's templates. A reference only it reads
 *   fails that execution after the run has started.
 *
 * A key read in both phases gives one issue per effect.
 */
export function checkVariableReadiness(params: {
  readonly model: WorkflowModel;
  /** Names that exist at workspace scope or at project scope. */
  readonly definedNames: ReadonlySet<string>;
}): RunIssue[] {
  const {model, definedNames} = params;
  const startReferences = collectRequired(
    collectRunRequirements(
      model,
      model.jobs.filter((job) => job.mode !== 'listening'),
    ).variables,
  );
  const startIdentities = new Set(startReferences.map(referenceIdentity));
  const executionReferences = model.jobs
    .filter((job) => job.mode === 'listening')
    .flatMap((job) => collectRequired(collectRunRequirements(model, [job]).variables))
    .filter((reference) => !startIdentities.has(referenceIdentity(reference)));

  return [
    ...issuesFor(startReferences, 'blocks-start', definedNames),
    ...issuesFor(executionReferences, 'fails-job', definedNames),
  ];
}

function collectRequired(references: readonly ReferencedVariable[]): ReferencedVariable[] {
  return references.filter(variableReferenceIsRequired);
}

function issuesFor(
  references: readonly ReferencedVariable[],
  effect: RunIssueEffect,
  definedNames: ReadonlySet<string>,
): RunIssue[] {
  return groupByKey(references.filter((reference) => !definedNames.has(reference.key))).map(
    (group) => ({kind: 'variable-missing' as const, ...group, effect}),
  );
}

/**
 * Report the step secrets a workflow reads that are not defined. The runner pulls them one
 * step at a time after the run has started, so a missing one fails that step and never
 * refuses the start.
 */
export function checkSecretReadiness(params: {
  readonly model: WorkflowModel;
  /** Names that exist at workspace scope or at project scope. */
  readonly definedNames: ReadonlySet<string>;
}): RunIssue[] {
  const {model, definedNames} = params;
  const missing = collectRunRequirements(model, model.jobs).secrets.filter(
    (reference) => reference.store === 'local' && !definedNames.has(reference.key),
  );
  return groupByKey(missing).map((group) => ({
    kind: 'secret-missing' as const,
    ...group,
    effect: 'fails-job' as const,
  }));
}

/**
 * List the `secrets.inputs.*` a workflow reads. Whether a run supplies them depends on the
 * trigger that starts it, so the caller compares them with each trigger's mapping.
 */
export function collectSecretInputReferences(model: WorkflowModel): KeyLocations[] {
  return groupByKey(
    collectRunRequirements(model, model.jobs).secrets.filter(
      (reference) => reference.store === 'inputs',
    ),
  );
}

/** One group per key, sorted by key, with each distinct place the key is read. */
function groupByKey(
  references: readonly (ReferencedVariable | ReferencedSecret)[],
): KeyLocations[] {
  const locationsByKey = new Map<string, Map<string, RunIssueLocation>>();
  for (const reference of references) {
    const locations = locationsByKey.get(reference.key) ?? new Map<string, RunIssueLocation>();
    locations.set(locationIdentity(reference), toLocation(reference));
    locationsByKey.set(reference.key, locations);
  }

  return [...locationsByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, locations]) => {
      const all = [...locations.values()];
      const more = all.length - RUN_ISSUE_LOCATIONS_MAX;
      return {
        key,
        locations: all.slice(0, RUN_ISSUE_LOCATIONS_MAX),
        ...(more > 0 ? {moreLocations: more} : {}),
      };
    });
}

function toLocation(reference: ReferencedVariable | ReferencedSecret): RunIssueLocation {
  return {
    ...(reference.jobKey === undefined ? {} : {jobKey: reference.jobKey}),
    ...(reference.step === undefined ? {} : {step: toStepLocation(reference.step)}),
    field: reference.field,
    ...(reference.envKey === undefined ? {} : {envKey: reference.envKey}),
  };
}

/** Inter-module payloads are JSON, which has no `undefined` values. */
function toStepLocation(step: NonNullable<ReferencedVariable['step']>): RunIssueStep {
  return {
    ...(step.key === undefined ? {} : {key: step.key}),
    ...(step.name === undefined ? {} : {name: step.name}),
    index: step.index,
  };
}

function locationIdentity(reference: ReferencedVariable | ReferencedSecret): string {
  return JSON.stringify([
    reference.jobKey,
    reference.step?.index,
    reference.field,
    reference.envKey,
  ]);
}

function referenceIdentity(reference: ReferencedVariable): string {
  return JSON.stringify([reference.key, reference.source, locationIdentity(reference)]);
}
