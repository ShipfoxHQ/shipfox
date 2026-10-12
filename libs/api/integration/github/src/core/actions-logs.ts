import {Buffer} from 'node:buffer';
import {GithubIntegrationProviderError} from './errors.js';
import {DEFAULT_JOB_LOG_TAIL_LINES} from './github-agent-tool-catalog.js';

export {DEFAULT_JOB_LOG_TAIL_LINES} from './github-agent-tool-catalog.js';
export const DEFAULT_JOB_LOG_CONTENT_WINDOW_LINES = 5000;
export const MAX_JOB_LOG_RING_BUFFER_LINES = 100000;
export const MAX_JOB_LOG_LINE_BYTES = 10 * 1024 * 1024;
export const MAX_TRUNCATED_JOB_LOG_LINE_CHARS = 1000;

export interface GithubJobLogSource {
  jobId: number;
  name?: string | undefined;
  conclusion?: string | undefined;
  /** Resolves the short-lived download URL of the job logs. */
  logsUrl: () => Promise<string>;
  /** Downloads the log text from the URL that `logsUrl` resolved. */
  fetchContent?: ((logsUrl: string) => Promise<string>) | undefined;
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

export const MAX_JOB_LOG_DOWNLOAD_BYTES = 64 * 1024 * 1024;

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

async function buildGithubJobLogData(
  input: BuildGithubSingleJobLogResultInput,
): Promise<GithubJobLogResult> {
  const result: GithubJobLogResult = {
    job_id: input.job.jobId,
    ...(input.job.name ? {job_name: input.job.name} : {}),
  };
  const logsUrl = await input.job.logsUrl();

  if (input.returnContent === true) {
    const logsContent = input.job.fetchContent ? await input.job.fetchContent(logsUrl) : '';
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
  }

  return {
    ...result,
    logs_url: logsUrl,
    message: 'Job logs are available for download',
    note: 'The logs_url provides a download link for the individual job logs in plain text format.\nUse return_content=true to get the actual log content.',
  };
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

/**
 * Downloads the text of a job log from the short-lived URL GitHub redirects to. The read stops at
 * `maxBytes`, so a very large log fails instead of filling memory.
 */
export async function downloadGithubJobLogs({
  url,
  timeoutMs,
  maxBytes = MAX_JOB_LOG_DOWNLOAD_BYTES,
}: {
  url: string;
  timeoutMs: number;
  maxBytes?: number;
}): Promise<string> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(url, {signal: abortController.signal});
    if (!response.ok) {
      throw new GithubIntegrationProviderError(
        'provider-rejected',
        `GitHub job logs download failed with status ${response.status}`,
      );
    }
    return await readTextWithLimit({response, maxBytes});
  } catch (error) {
    if (error instanceof GithubIntegrationProviderError) throw error;
    if (abortController.signal.aborted) {
      throw new GithubIntegrationProviderError('timeout', 'GitHub job logs download timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readTextWithLimit({
  response,
  maxBytes,
}: {
  response: Response;
  maxBytes: number;
}): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let received = 0;
  let chunk = await reader.read();
  while (!chunk.done) {
    const {value} = chunk;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new GithubIntegrationProviderError(
        'provider-rejected',
        `GitHub job logs exceed the ${maxBytes} byte download limit`,
      );
    }
    chunks.push(value);
    chunk = await reader.read();
  }
  return Buffer.concat(chunks).toString('utf8');
}
