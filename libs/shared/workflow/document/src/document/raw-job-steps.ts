export interface RawJobStep {
  readonly path: (string | number)[];
  readonly step: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Yields every step of an unparsed workflow document, the members of a `parallel` block included,
 * each with its path in the document. Use it where a step is read before the document is checked,
 * since `job.steps` holds the blocks too.
 */
export function* rawJobSteps(input: unknown): Generator<RawJobStep> {
  if (!isRecord(input) || !isRecord(input.jobs)) return;
  for (const [jobName, job] of Object.entries(input.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    for (const [index, step] of job.steps.entries()) {
      if (!isRecord(step)) continue;
      const path = ['jobs', jobName, 'steps', index];
      yield {path, step};
      yield* rawBlockMembers({path, step});
    }
  }
}

function* rawBlockMembers(block: RawJobStep): Generator<RawJobStep> {
  if (!Array.isArray(block.step.parallel)) return;
  for (const [member, step] of block.step.parallel.entries()) {
    if (isRecord(step)) yield {path: [...block.path, 'parallel', member], step};
  }
}
