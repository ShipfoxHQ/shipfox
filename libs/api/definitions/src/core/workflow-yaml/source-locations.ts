import {isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, type YAMLMap} from 'yaml';
import type {
  WorkflowSourceLocation,
  WorkflowStepSourceLocationMap,
} from '../entities/workflow-model.js';

export function extractWorkflowStepSourceLocations(source: string): WorkflowStepSourceLocationMap {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {lineCounter});
  if (document.errors.length > 0 || !isMap(document.contents)) return new Map();

  const jobs = getMapValue(document.contents, 'jobs');
  if (!isMap(jobs)) return new Map();

  const locations = new Map<string, Map<number, WorkflowSourceLocation>>();

  for (const jobPair of jobs.items) {
    addJobStepLocations(jobPair.key, jobPair.value, lineCounter, locations);
  }

  return locations;
}

/** Line ranges of the `steps` of a composite action manifest, by step index. */
export function extractActionStepSourceLocations(
  source: string,
): ReadonlyMap<number, WorkflowSourceLocation> {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {lineCounter});
  if (document.errors.length > 0 || !isMap(document.contents)) return new Map();

  const steps = getMapValue(document.contents, 'steps');
  if (!isSeq(steps)) return new Map();

  const locations = new Map<number, WorkflowSourceLocation>();
  for (const [index, step] of steps.items.entries()) {
    const location = sourceLocationFor(step, lineCounter);
    if (location) locations.set(index, location);
  }
  return locations;
}

function addJobStepLocations(
  key: unknown,
  value: unknown,
  lineCounter: LineCounter,
  locations: Map<string, Map<number, WorkflowSourceLocation>>,
): void {
  const jobName = scalarString(key);
  if (jobName === undefined || !isMap(value)) return;
  const steps = getMapValue(value, 'steps');
  if (!isSeq(steps)) return;

  // A `parallel` block is expanded into its members, then a wait for them, so the locations
  // are keyed by the index in the expanded list, as the normalizer indexes steps.
  const stepLocations = new Map<number, WorkflowSourceLocation>();
  let expandedIndex = 0;
  const add = (node: unknown) => {
    const location = sourceLocationFor(node, lineCounter);
    if (location) stepLocations.set(expandedIndex, location);
    expandedIndex += 1;
  };
  for (const step of steps.items) {
    const members = isMap(step) ? getMapValue(step, 'parallel') : undefined;
    if (!isSeq(members)) {
      add(step);
      continue;
    }
    for (const member of members.items) add(member);
    add(step);
  }
  if (stepLocations.size > 0) locations.set(jobName, stepLocations);
}

function getMapValue(map: YAMLMap, key: string): unknown {
  for (const item of map.items) {
    if (scalarString(item.key) === key) return item.value;
  }

  return undefined;
}

function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

function sourceLocationFor(
  node: unknown,
  lineCounter: LineCounter,
): WorkflowSourceLocation | undefined {
  if (!isNode(node)) return undefined;
  const range = node?.range;
  if (!range) return undefined;

  const start = lineCounter.linePos(range[0]);
  const end = lineCounter.linePos(range[1]);
  if (!start || !end) return undefined;

  const endLine = end.col === 1 && end.line > start.line ? end.line - 1 : end.line;
  return {startLine: start.line, endLine: Math.max(start.line, endLine)};
}
