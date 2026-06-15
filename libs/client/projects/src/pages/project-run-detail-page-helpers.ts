import type {RunDetailDto} from '@shipfox/api-workflows-dto';

export type DetailJob = RunDetailDto['jobs'][number];
export type DetailStep = DetailJob['steps'][number];
export type DetailAttempt = DetailStep['attempts'][number];

export function sourceLineDescriptors(sourceYaml: string | null) {
  if (!sourceYaml) return [];

  const lines = sourceYaml.split('\n');
  let offset = 0;
  return lines.map((text, lineIndex) => {
    const descriptor = {id: String(offset), number: lineIndex + 1, text};
    offset += text.length + 1;
    return descriptor;
  });
}

export function pickInterestingJob(jobs: DetailJob[]) {
  return (
    jobs.find((job) => job.status === 'failed') ??
    jobs.find((job) => job.status === 'running') ??
    jobs[0]
  );
}

export function pickInterestingStep(steps: DetailStep[]) {
  return (
    steps.find((step) => step.status === 'failed') ??
    steps.find((step) => step.status === 'running') ??
    steps.find((step) => step.attempts.length > 0) ??
    steps[0]
  );
}
