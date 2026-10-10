import {
  buildGithubFailedJobLogsResult,
  buildGithubSingleJobLogResult,
  DEFAULT_JOB_LOG_TAIL_LINES,
  downloadGithubJobLogs,
  MAX_JOB_LOG_LINE_BYTES,
  MAX_TRUNCATED_JOB_LOG_LINE_CHARS,
  processGithubJobLogContent,
} from './actions-logs.js';

describe('buildGithubSingleJobLogResult', () => {
  it('returns a logs URL without fetching content by default', async () => {
    const fetchContent = vi.fn((_url: string) => Promise.resolve('full log'));

    const result = await buildGithubSingleJobLogResult({
      job: job({fetchContent}),
    });

    expect(fetchContent).not.toHaveBeenCalled();
    expect(result).toEqual({
      job_id: 1,
      job_name: 'Unit tests',
      logs_url: 'https://github.example/logs/1',
      message: 'Job logs are available for download',
      note: 'The logs_url provides a download link for the individual job logs in plain text format.\nUse return_content=true to get the actual log content.',
    });
  });

  it('downloads the content from the resolved logs URL', async () => {
    const fetchContent = vi.fn((_url: string) => Promise.resolve('line 1\nline 2'));

    await buildGithubSingleJobLogResult({job: job({fetchContent}), returnContent: true});

    expect(fetchContent).toHaveBeenCalledWith('https://github.example/logs/1');
  });

  it('returns default tail content when content is requested', async () => {
    const lines = Array.from(
      {length: DEFAULT_JOB_LOG_TAIL_LINES + 50},
      (_value, index) => `line ${index + 1}`,
    );

    const result = await buildGithubSingleJobLogResult({
      job: job({fetchContent: async () => lines.join('\n')}),
      returnContent: true,
    });

    expect(result).toEqual({
      job_id: 1,
      job_name: 'Unit tests',
      logs_content: lines.slice(-DEFAULT_JOB_LOG_TAIL_LINES).join('\n'),
      message: 'Job logs content retrieved successfully',
      original_length: DEFAULT_JOB_LOG_TAIL_LINES + 50,
    });
  });
});

describe('buildGithubFailedJobLogsResult', () => {
  it('reports when a workflow run has no failed jobs', async () => {
    const result = await buildGithubFailedJobLogsResult({
      runId: 123,
      jobs: [job({conclusion: 'success'})],
    });

    expect(result).toEqual({
      message: 'No failed jobs found in this workflow run',
      run_id: 123,
      total_jobs: 1,
      failed_jobs: 0,
    });
  });

  it('returns logs for every failed job without a failed-job cap', async () => {
    const jobs = Array.from({length: 25}, (_value, index) =>
      job({jobId: index + 1, conclusion: index % 2 === 0 ? 'failure' : 'success'}),
    );

    const result = await buildGithubFailedJobLogsResult({runId: 123, jobs});

    expect(result).toMatchObject({
      message: 'Retrieved logs for 13 failed jobs',
      run_id: 123,
      total_jobs: 25,
      failed_jobs: 13,
      return_format: {content: false, urls: true},
    });
    expect(result.logs).toHaveLength(13);
    expect(result.logs?.[0]).toMatchObject({
      job_id: 1,
      job_name: 'Unit tests',
      logs_url: 'https://github.example/logs/1',
    });
  });

  it('keeps a failed logs URL lookup local to the affected job', async () => {
    const result = await buildGithubFailedJobLogsResult({
      runId: 123,
      jobs: [
        job({jobId: 1, logsUrl: () => Promise.reject(new Error('logs expired'))}),
        job({jobId: 2}),
      ],
    });

    expect(result.logs).toEqual([
      {job_id: 1, job_name: 'Unit tests', error: 'logs expired'},
      expect.objectContaining({job_id: 2, logs_url: 'https://github.example/logs/2'}),
    ]);
  });

  it('keeps failed-job fetch errors local to the affected job', async () => {
    const result = await buildGithubFailedJobLogsResult({
      runId: 123,
      returnContent: true,
      jobs: [
        job({
          conclusion: 'failure',
          fetchContent: () => Promise.reject(new Error('download failed')),
        }),
      ],
    });

    expect(result.logs).toEqual([
      {
        job_id: 1,
        job_name: 'Unit tests',
        error: 'download failed',
      },
    ]);
  });
});

describe('processGithubJobLogContent', () => {
  it('uses the smaller of tail_lines and content window size', () => {
    const lines = Array.from({length: 10}, (_value, index) => `line ${index + 1}`);

    const result = processGithubJobLogContent(lines.join('\n'), {
      tailLines: 8,
      contentWindowSize: 3,
    });

    expect(result).toEqual({
      content: ['line 8', 'line 9', 'line 10'].join('\n'),
      totalLines: 10,
    });
  });

  it('defaults invalid tail_lines to 500', () => {
    const lines = Array.from(
      {length: DEFAULT_JOB_LOG_TAIL_LINES + 1},
      (_value, index) => `line ${index + 1}`,
    );

    const result = processGithubJobLogContent(lines.join('\n'), {tailLines: 0});

    expect(result.content).toBe(lines.slice(-DEFAULT_JOB_LOG_TAIL_LINES).join('\n'));
    expect(result.totalLines).toBe(DEFAULT_JOB_LOG_TAIL_LINES + 1);
  });

  it('truncates extremely long single lines', () => {
    const line = 'a'.repeat(MAX_JOB_LOG_LINE_BYTES + 1);

    const result = processGithubJobLogContent(line);

    expect(result.content).toBe(`${'a'.repeat(MAX_TRUNCATED_JOB_LOG_LINE_CHARS)}...\n[TRUNCATED]`);
    expect(result.totalLines).toBe(1);
  });
});

function job(
  overrides: Partial<Parameters<typeof buildGithubSingleJobLogResult>[0]['job']> = {},
): Parameters<typeof buildGithubSingleJobLogResult>[0]['job'] {
  const jobId = overrides.jobId ?? 1;
  return {
    jobId,
    name: 'Unit tests',
    conclusion: 'failure',
    logsUrl: () => Promise.resolve(`https://github.example/logs/${jobId}`),
    ...overrides,
  };
}

describe('downloadGithubJobLogs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the text of the download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('line 1\nline 2\n'))),
    );

    const text = await downloadGithubJobLogs({
      url: 'https://objects.example/log.txt',
      timeoutMs: 1000,
    });

    expect(text).toBe('line 1\nline 2\n');
  });

  it('refuses a URL that is not https', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadGithubJobLogs({url: 'http://objects.example/log.txt', timeoutMs: 1000}),
    ).rejects.toThrow('GitHub job logs download URL is not https');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails a download that answers with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('gone', {status: 410}))),
    );

    await expect(
      downloadGithubJobLogs({url: 'https://objects.example/log.txt', timeoutMs: 1000}),
    ).rejects.toThrow('GitHub job logs download failed with status 410');
  });

  it('stops a download that passes the byte limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('x'.repeat(100)))),
    );

    await expect(
      downloadGithubJobLogs({
        url: 'https://objects.example/log.txt',
        timeoutMs: 1000,
        maxBytes: 10,
      }),
    ).rejects.toThrow('exceed the 10 byte download limit');
  });
});
