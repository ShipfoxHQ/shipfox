import {Buffer} from 'node:buffer';

export const DEFAULT_JOB_LOG_TAIL_LINES = 500;
export const DEFAULT_JOB_LOG_CONTENT_WINDOW_LINES = 5000;
export const MAX_JOB_LOG_RING_BUFFER_LINES = 100000;
export const MAX_JOB_LOG_LINE_BYTES = 10 * 1024 * 1024;
export const MAX_TRUNCATED_JOB_LOG_LINE_CHARS = 1000;

export interface GithubJobLogSource {
  jobId: number;
  name?: string | undefined;
  conclusion?: string | undefined;
  logsUrl: string;
  fetchContent?: (() => Promise<string>) | undefined;
}

export interface BuildGithubSingleJobLogResultInput {
  job: GithubJobLogSource;
  returnContent?: boolean | undefined;
  tailLines?: number | undefined;
  contentWindowSize?: number | undefined;
}

export interface BuildGithubFailedJobLogsResultInput {
  jobs: readonly GithubJobLogSource[];
  runId: number;
  returnContent?: boolean | undefined;
  tailLines?: number | undefined;
  contentWindowSize?: number | undefined;
}

export type GithubJobLogResult = Record<string, unknown>;

export interface GithubFailedJobLogsResult {
  message: string;
  run_id: number;
  total_jobs: number;
  failed_jobs: number;
  logs?: GithubJobLogResult[] | undefined;
  return_format?: {content: boolean; urls: boolean} | undefined;
}

export function buildGithubSingleJobLogResult(
  input: BuildGithubSingleJobLogResultInput,
): Promise<GithubJobLogResult> {
  return buildGithubJobLogData(input);
}

export async function buildGithubFailedJobLogsResult(
  input: BuildGithubFailedJobLogsResultInput,
): Promise<GithubFailedJobLogsResult> {
  const failedJobs = input.jobs.filter((job) => job.conclusion === 'failure');

  if (failedJobs.length === 0) {
    return {
      message: 'No failed jobs found in this workflow run',
      run_id: input.runId,
      total_jobs: input.jobs.length,
      failed_jobs: 0,
    };
  }

  const logs: GithubJobLogResult[] = [];
  for (const job of failedJobs) {
    try {
      logs.push(await buildGithubJobLogData({job, ...input}));
    } catch (error) {
      logs.push({
        job_id: job.jobId,
        ...(job.name ? {job_name: job.name} : {}),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    message: `Retrieved logs for ${failedJobs.length} failed jobs`,
    run_id: input.runId,
    total_jobs: input.jobs.length,
    failed_jobs: failedJobs.length,
    logs,
    return_format: {content: input.returnContent === true, urls: input.returnContent !== true},
  };
}

function buildGithubJobLogData(
  input: BuildGithubSingleJobLogResultInput,
): Promise<GithubJobLogResult> {
  const result: GithubJobLogResult = {
    job_id: input.job.jobId,
    ...(input.job.name ? {job_name: input.job.name} : {}),
  };

  if (input.returnContent === true) {
    const content = input.job.fetchContent ? input.job.fetchContent() : Promise.resolve('');
    return content.then((logsContent) => {
      const processed = processGithubJobLogContent(logsContent, {
        tailLines: input.tailLines,
        contentWindowSize: input.contentWindowSize,
      });
      return {
        ...result,
        logs_content: processed.content,
        message: 'Job logs content retrieved successfully',
        original_length: processed.totalLines,
      };
    });
  }

  return Promise.resolve({
    ...result,
    logs_url: input.job.logsUrl,
    message: 'Job logs are available for download',
    note: 'The logs_url provides a download link for the individual job logs in plain text format.\nUse return_content=true to get the actual log content.',
  });
}

export function processGithubJobLogContent(
  content: string,
  options: {tailLines?: number | undefined; contentWindowSize?: number | undefined} = {},
): {content: string; totalLines: number} {
  const tailLines = normalizeTailLines(options.tailLines);
  const maxLines = Math.min(
    tailLines,
    options.contentWindowSize ?? DEFAULT_JOB_LOG_CONTENT_WINDOW_LINES,
  );
  const processed = processResponseAsRingBufferToEnd(content, maxLines);
  const lines = processed.content.split('\n');
  const finalLines = lines.length > tailLines ? lines.slice(-tailLines) : lines;

  return {content: finalLines.join('\n'), totalLines: processed.totalLines};
}

function normalizeTailLines(tailLines: number | undefined): number {
  if (tailLines === undefined) return DEFAULT_JOB_LOG_TAIL_LINES;
  if (!Number.isFinite(tailLines) || tailLines <= 0) return DEFAULT_JOB_LOG_TAIL_LINES;
  return Math.trunc(tailLines);
}

function processResponseAsRingBufferToEnd(
  content: string,
  maxJobLogLines: number,
): {content: string; totalLines: number} {
  let maxLines = Math.trunc(maxJobLogLines);
  if (maxLines <= 0) maxLines = DEFAULT_JOB_LOG_TAIL_LINES;
  if (maxLines > MAX_JOB_LOG_RING_BUFFER_LINES) maxLines = MAX_JOB_LOG_RING_BUFFER_LINES;

  const lines = new Array<string>(maxLines);
  const validLines = new Array<boolean>(maxLines).fill(false);
  let totalLines = 0;
  let writeIndex = 0;

  const storeLine = (line: string) => {
    lines[writeIndex] = truncateLongLine(line);
    validLines[writeIndex] = true;
    totalLines += 1;
    writeIndex = (writeIndex + 1) % maxLines;
  };

  for (const line of splitLogLines(content)) {
    storeLine(line);
  }

  const result: string[] = [];
  const linesInBuffer = Math.min(totalLines, maxLines);
  const startIndex = totalLines > maxLines ? writeIndex : 0;

  for (let offset = 0; offset < linesInBuffer; offset += 1) {
    const index = (startIndex + offset) % maxLines;
    if (validLines[index]) result.push(lines[index] ?? '');
  }

  return {content: result.join('\n'), totalLines};
}

function splitLogLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split('\n');
  if (content.endsWith('\n')) lines.pop();
  return lines;
}

function truncateLongLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') < MAX_JOB_LOG_LINE_BYTES) return line;
  return `${Array.from(line).slice(0, MAX_TRUNCATED_JOB_LOG_LINE_CHARS).join('')}...\n[TRUNCATED]`;
}
