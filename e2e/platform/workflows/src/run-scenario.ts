import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';
import type {
  FireManualTriggerResponseDto,
  TriggerEventDetailResponseDto,
  TriggerEventListResponseDto,
} from '@shipfox/api-triggers-dto';
import type {WorkflowRunListResponseDto} from '@shipfox/api-workflows-dto';
import {type ApiFetch, createApiClient, E2eApiError} from '@shipfox/e2e-core';
import {waitForDefinition} from '@shipfox/e2e-helper-definitions';
import {commitFiles, createRepo} from '@shipfox/e2e-helper-integrations-gitea';
import {fetchStepLogs} from '@shipfox/e2e-helper-logs';
import {
  type LocalRunnerExit,
  type LocalRunnerHandle,
  localRunnerLogTail,
  mintManualRegistrationToken,
  startLocalRunner,
  stopLocalRunner,
  waitForLocalRunnerExit,
} from '@shipfox/e2e-helper-runners';
import {
  waitForRunByCommit,
  waitForRunByDeliveryId,
  waitForRunTerminal,
} from '@shipfox/e2e-helper-workflows';
import {createProject, giteaExternalRepositoryId} from './create-project.js';
import {evaluateExpectations, evaluateLogs, logText, type Mismatch} from './expect.js';
import {evaluateRejection} from './reject.js';
import type {Scenario} from './scenarios.js';
import {type SuiteContext, suiteRunDir} from './suite-context.js';

const GITEA_SOURCE_PLACEHOLDER = '__GITEA_SOURCE__';
const GITEA_REPOSITORY_PLACEHOLDER = '__GITEA_REPOSITORY__';
const WEBHOOK_SOURCE_PLACEHOLDER = '__WEBHOOK_SOURCE__';
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';
const LOG_ATTACHMENT_NAME_PART_RE = /[^a-zA-Z0-9._-]+/g;
const REJECTION_NO_RUN_TIMEOUT_MS = 15_000;
const WEBHOOK_RECEIVED_EVENT = 'received';

export interface Attachment {
  name: string;
  contentType: string;
  body: string;
}

export interface RunScenarioParams {
  scenario: Scenario;
  suite: SuiteContext;
  // Attaches a debugging artifact to the running test (a thin wrapper over
  // testInfo.attach), so the scenario driver stays free of Playwright types.
  attach: (attachment: Attachment) => Promise<void>;
}

interface StepLogAttachmentRequest {
  path: string;
  stepId: string;
  attempt: number;
}

interface PollingOptions {
  fetch?: ApiFetch | undefined;
  projectId: string;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  token: string;
}

interface WebhookDiagnosticsRequest {
  deliveryIds: string[];
  source: string;
}

function logAttachmentName(path: string): string {
  return path.replaceAll(LOG_ATTACHMENT_NAME_PART_RE, '_').replace(/^_+|_+$/g, '');
}

function collectStepLogAttachmentRequests(
  runDetail: Awaited<ReturnType<typeof waitForRunTerminal>>,
) {
  const requests: StepLogAttachmentRequest[] = [];
  for (const job of runDetail.jobs) {
    for (const execution of job.job_executions) {
      for (const step of execution.steps) {
        requests.push({
          path: `jobs.${job.key}.executions.${execution.sequence}.steps.${
            step.key ?? logAttachmentName(step.name)
          }`,
          stepId: step.id,
          attempt: step.current_attempt,
        });
      }
    }
  }
  return requests;
}

async function fetchLogAttachment(
  request: StepLogAttachmentRequest,
  token: string,
): Promise<Attachment> {
  try {
    const logs = await fetchStepLogs({
      stepId: request.stepId,
      attempt: request.attempt,
      token,
    });
    return {
      name: `logs-${logAttachmentName(request.path)}.ndjson`,
      contentType: 'application/x-ndjson',
      body: logs.ndjson,
    };
  } catch (error) {
    return {
      name: `logs-${logAttachmentName(request.path)}.error.txt`,
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

async function attachLocalRunnerLog(
  attach: RunScenarioParams['attach'],
  runnerLogFile: string,
): Promise<void> {
  try {
    await attach({
      name: `runner-${logAttachmentName(runnerLogFile)}.log`,
      contentType: 'text/plain',
      body: await readFile(runnerLogFile, 'utf8'),
    });
  } catch (error) {
    await attach({
      name: `runner-${logAttachmentName(runnerLogFile)}.error.txt`,
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}

function isFailedRunnerExit(exit: LocalRunnerExit): boolean {
  return exit.code !== 0 || exit.signal !== null;
}

async function waitForRunTerminalOrFailedRunner(params: {
  runId: string;
  token: string;
  timeoutMs: number;
  runner: LocalRunnerHandle;
}): ReturnType<typeof waitForRunTerminal> {
  const runTerminal = waitForRunTerminal({
    runId: params.runId,
    token: params.token,
    timeoutMs: params.timeoutMs,
  });
  const runnerExit = waitForLocalRunnerExit(params.runner);

  const first = await Promise.race([
    runTerminal.then((runDetail) => ({kind: 'run' as const, runDetail})),
    runnerExit.then((exit) => ({kind: 'runner' as const, exit})),
  ]);

  if (first.kind === 'run') return first.runDetail;
  if (!isFailedRunnerExit(first.exit)) return await runTerminal;

  throw new Error(
    `Local runner exited before workflow reached a terminal state (code ${first.exit.code}, signal ${first.exit.signal})${localRunnerLogTail(params.runner.logFile)}`,
  );
}

async function waitForDefinitionSyncTerminal(
  options: PollingOptions,
): Promise<DefinitionListResponseDto> {
  const client = createApiClient({fetch: options.fetch, token: options.token});
  const deadline = Date.now() + options.timeoutMs;
  let lastResponse: DefinitionListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<DefinitionListResponseDto>(
      'get',
      `/definitions?${params}`,
      {signal: options.signal},
    );

    const status = lastResponse.sync?.status;
    if (status === 'failed' || status === 'succeeded') return lastResponse;

    await delay(250, undefined, {signal: options.signal});
  }

  const status = lastResponse?.sync?.status ?? 'null';
  throw new Error(`Timed out waiting for definition sync to settle: syncStatus=${status}`);
}

async function waitForNoWorkflowRuns(options: PollingOptions): Promise<WorkflowRunListResponseDto> {
  const client = createApiClient({fetch: options.fetch, token: options.token});
  const deadline = Date.now() + options.timeoutMs;
  let lastResponse: WorkflowRunListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<WorkflowRunListResponseDto>(
      'get',
      `/workflows/runs?${params}`,
      {signal: options.signal},
    );
    if (lastResponse.runs.length > 0) return lastResponse;

    await delay(250, undefined, {signal: options.signal});
  }

  return lastResponse ?? {runs: [], next_cursor: null, filtered_total_count: null};
}

// Definition sync creates trigger subscriptions asynchronously, so a push can reach
// dispatch before a subscription exists. Each retry needs a fresh head SHA for correlation.
async function triggerPushAndAwaitRun(params: {
  org: string;
  repo: string;
  scenario: string;
  uniqueId: string;
  message?: string | undefined;
  projectId: string;
  token: string;
}): Promise<string> {
  const maxAttempts = 8;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const triggerSha = await commitFiles({
      org: params.org,
      repo: params.repo,
      message: params.message ?? `trigger ${params.scenario} ${params.uniqueId} #${attempt}`,
      files: [
        {
          path: `.shipfox-e2e-trigger-${attempt}`,
          content: `${params.scenario} ${params.uniqueId} ${attempt}\n`,
        },
      ],
    });
    try {
      const run = await waitForRunByCommit({
        projectId: params.projectId,
        headCommitSha: triggerSha,
        token: params.token,
        timeoutMs: 15_000,
      });
      return run.id;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared for ${params.scenario} after ${maxAttempts} trigger pushes`);
}

async function createWebhookConnection(params: {
  client: ReturnType<typeof createApiClient>;
  scenario: string;
  slug: string;
  uniqueId: string;
  workspaceId: string;
}): Promise<WebhookConnectionDto> {
  return await params.client.requestJson<WebhookConnectionDto>(
    'post',
    '/integrations/webhook/connections',
    {
      json: {
        workspace_id: params.workspaceId,
        name: `E2E ${params.scenario} ${params.uniqueId}`,
        slug: params.slug,
      },
    },
  );
}

function webhookUrlWithQuery(
  inboundUrl: string,
  query: Record<string, string> | undefined,
): string {
  const url = new URL(inboundUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function webhookHeaders(
  configuredHeaders: Record<string, string> | undefined,
  deliveryId: string,
): Headers {
  const headers = new Headers(configuredHeaders);
  headers.set('x-delivery-id', deliveryId);
  return headers;
}

async function attachWebhookTriggerDiagnostics(params: {
  attach: RunScenarioParams['attach'];
  client: ReturnType<typeof createApiClient>;
  deliveryIds: string[];
  source: string;
  workspaceId: string;
}): Promise<void> {
  try {
    const search = new URLSearchParams({
      workspace_id: params.workspaceId,
      source: params.source,
      event: WEBHOOK_RECEIVED_EVENT,
      limit: '50',
    });
    const events = await params.client.requestJson<TriggerEventListResponseDto>(
      'get',
      `/trigger-events?${search}`,
    );
    await params.attach({
      name: 'webhook-trigger-events.json',
      contentType: 'application/json',
      body: JSON.stringify(events, null, 2),
    });

    const deliveryIds = new Set(params.deliveryIds);
    for (const event of events.trigger_events) {
      if (!event.delivery_id || !deliveryIds.has(event.delivery_id)) continue;
      const detail = await params.client.requestJson<TriggerEventDetailResponseDto>(
        'get',
        `/trigger-events/${event.id}`,
      );
      await params.attach({
        name: `webhook-trigger-event-${logAttachmentName(event.delivery_id)}.json`,
        contentType: 'application/json',
        body: JSON.stringify(detail, null, 2),
      });
    }
  } catch (error) {
    await params
      .attach({
        name: 'webhook-trigger-events.error.txt',
        contentType: 'text/plain',
        body: error instanceof Error ? error.message : String(error),
      })
      .catch(() => undefined);
  }
}

async function triggerWebhookAndAwaitRun(params: {
  attach: RunScenarioParams['attach'];
  client: ReturnType<typeof createApiClient>;
  connection: WebhookConnectionDto;
  projectId: string;
  scenario: string;
  token: string;
  webhook:
    | {
        body?: unknown;
        headers?: Record<string, string> | undefined;
        query?: Record<string, string> | undefined;
      }
    | undefined;
  workspaceId: string;
}): Promise<{deliveryIds: string[]; runId: string}> {
  const maxAttempts = 8;
  const deliveryIds: string[] = [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const deliveryId = crypto.randomUUID();
    deliveryIds.push(deliveryId);
    await params.client.requestJson<{delivery_id: string}>(
      'post',
      webhookUrlWithQuery(params.connection.inbound_url, params.webhook?.query),
      {
        headers: webhookHeaders(params.webhook?.headers, deliveryId),
        json: params.webhook?.body ?? {
          scenario: params.scenario,
          attempt,
          delivery_id: deliveryId,
        },
      },
    );

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId,
        token: params.token,
        timeoutMs: 15_000,
      });
      return {deliveryIds, runId: run.id};
    } catch (error) {
      lastError = error;
    }
  }

  await attachWebhookTriggerDiagnostics({
    attach: params.attach,
    client: params.client,
    deliveryIds,
    source: params.connection.slug,
    workspaceId: params.workspaceId,
  });
  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared for ${params.scenario} after ${maxAttempts} webhook deliveries`);
}

async function fireManualAndAwaitRun(params: {
  client: ReturnType<typeof createApiClient>;
  definitionId: string;
  inputs: Record<string, unknown>;
  scenario: string;
}): Promise<string> {
  const maxAttempts = 8;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await params.client.requestJson<FireManualTriggerResponseDto>(
        'post',
        `/workflow-definitions/${params.definitionId}/fire-manual`,
        {json: {inputs: params.inputs}},
      );
      return response.workflow_run_id;
    } catch (error) {
      if (!(error instanceof E2eApiError) || error.status !== 404) throw error;
      lastError = error;
      await delay(500);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Manual trigger for ${params.scenario} was not ready after ${maxAttempts} attempts`,
      );
}

/**
 * Drives one declarative scenario end to end: fresh repo and project, seed commit,
 * definition-resolved poll, trigger, terminal-run poll, then expect.yaml evaluation.
 * Returns every mismatch (empty means the scenario matched) and attaches the run
 * detail, the diff, and fetched logs when it did not.
 */
export async function runScenario(params: RunScenarioParams): Promise<Mismatch[]> {
  const {scenario, suite} = params;
  const token = suite.sessionToken;
  const client = createApiClient({token});

  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-${scenario.name}-${uniqueId}`;
  const repo = `${scenario.name}-${uniqueId}`;
  const webhookSlug = `webhook-${scenario.name}-${uniqueId}`;
  const workflowYaml = scenario.workflowYaml
    .replaceAll(GITEA_SOURCE_PLACEHOLDER, suite.connectionSlug)
    .replaceAll(GITEA_REPOSITORY_PLACEHOLDER, `${suite.org}/${repo}`)
    .replaceAll(WEBHOOK_SOURCE_PLACEHOLDER, webhookSlug)
    .replaceAll(RUNNER_LABEL_PLACEHOLDER, runnerLabel);

  let runner: LocalRunnerHandle | undefined;
  let runnerLogFile: string | undefined;
  let webhookDiagnostics: WebhookDiagnosticsRequest | undefined;

  try {
    const webhookConnection =
      scenario.kind === 'expect' && scenario.expectation.trigger === 'webhook'
        ? await createWebhookConnection({
            client,
            scenario: scenario.name,
            slug: webhookSlug,
            uniqueId,
            workspaceId: suite.workspaceId,
          })
        : undefined;

    await createRepo({org: suite.org, name: repo});
    // Project binding starts a definition sync, so the repo must already contain the workflow.
    await commitFiles({
      org: suite.org,
      repo,
      message: `seed ${scenario.name}`,
      files: [
        {path: scenario.configPath, content: workflowYaml},
        ...scenario.extraFiles.map((file) => ({path: file.path, content: file.content})),
      ],
    });

    const project = await createProject({
      workspaceId: suite.workspaceId,
      sessionToken: token,
      name: repo,
      connectionId: suite.connectionId,
      externalRepositoryId: giteaExternalRepositoryId(suite.org, repo),
    });

    if (scenario.kind === 'reject') {
      const definitions = await waitForDefinitionSyncTerminal({
        projectId: project.id,
        token,
        timeoutMs: 60_000,
      });
      const runs = await waitForNoWorkflowRuns({
        projectId: project.id,
        token,
        timeoutMs: REJECTION_NO_RUN_TIMEOUT_MS,
      });
      const mismatches = evaluateRejection(
        {sync: definitions.sync, runs: runs.runs},
        scenario.rejection,
      );

      if (mismatches.length > 0) {
        await params.attach({
          name: 'definition-sync.json',
          contentType: 'application/json',
          body: JSON.stringify(definitions, null, 2),
        });
        await params.attach({
          name: 'workflow-runs.json',
          contentType: 'application/json',
          body: JSON.stringify(runs, null, 2),
        });
        await params.attach({
          name: 'mismatches.json',
          contentType: 'application/json',
          body: JSON.stringify(mismatches, null, 2),
        });
      }

      return mismatches;
    }

    const definition = await waitForDefinition({
      projectId: project.id,
      configPath: scenario.configPath,
      token,
    });

    const registrationToken = await mintManualRegistrationToken({
      workspaceId: suite.workspaceId,
      userToken: token,
      name: `E2E ${scenario.name} ${uniqueId}`,
      ttlSeconds: 3600,
    });
    const runDir = suiteRunDir();
    const runnerLogDir = join(runDir, 'runners');
    runnerLogFile = join(runnerLogDir, `${runnerLabel}.log`);
    await mkdir(runnerLogDir, {recursive: true});
    runner = startLocalRunner({
      workspaceId: suite.workspaceId,
      registrationToken: registrationToken.raw_token,
      labels: [runnerLabel],
      logFile: runnerLogFile,
      workspaceRoot: join(runDir, 'runner-workspaces', runnerLabel),
    });

    let runId: string;
    if (scenario.expectation.trigger === 'manual') {
      runId = await fireManualAndAwaitRun({
        client,
        definitionId: definition.id,
        inputs: scenario.expectation.inputs ?? {},
        scenario: scenario.name,
      });
    } else if (scenario.expectation.trigger === 'webhook') {
      if (!webhookConnection) throw new Error(`Webhook connection missing for ${scenario.name}`);
      const result = await triggerWebhookAndAwaitRun({
        attach: params.attach,
        client,
        connection: webhookConnection,
        projectId: project.id,
        scenario: scenario.name,
        token,
        webhook: scenario.expectation.webhook,
        workspaceId: suite.workspaceId,
      });
      webhookDiagnostics = {deliveryIds: result.deliveryIds, source: webhookConnection.slug};
      runId = result.runId;
    } else {
      runId = await triggerPushAndAwaitRun({
        org: suite.org,
        repo,
        scenario: scenario.name,
        uniqueId,
        message: scenario.expectation.push?.message,
        projectId: project.id,
        token,
      });
    }

    const runDetail = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: scenario.expectation.timeout_seconds * 1000,
      runner,
    });

    const {mismatches, logRequirements} = evaluateExpectations(runDetail, scenario.expectation);
    const allMismatches = [...mismatches];
    const fetchedLogs: Attachment[] = [];
    for (const requirement of logRequirements) {
      let logs: Awaited<ReturnType<typeof fetchStepLogs>>;
      try {
        logs = await fetchStepLogs({
          stepId: requirement.stepId,
          attempt: requirement.attempt,
          token,
        });
      } catch (error) {
        allMismatches.push({
          path: `${requirement.path}.logs`,
          expected: 'readable',
          actual: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      fetchedLogs.push({
        name: `logs-${requirement.path.replaceAll('/', '_')}.ndjson`,
        contentType: 'application/x-ndjson',
        body: logs.ndjson,
      });
      allMismatches.push(
        ...evaluateLogs({
          path: requirement.path,
          text: logText(logs.records),
          include: requirement.include,
          exclude: requirement.exclude,
        }),
      );
    }

    if (allMismatches.length > 0) {
      await params.attach({
        name: 'run-detail.json',
        contentType: 'application/json',
        body: JSON.stringify(runDetail, null, 2),
      });
      await params.attach({
        name: 'mismatches.json',
        contentType: 'application/json',
        body: JSON.stringify(allMismatches, null, 2),
      });
      for (const log of fetchedLogs) await params.attach(log);
      if (runnerLogFile !== undefined) await attachLocalRunnerLog(params.attach, runnerLogFile);
      if (webhookDiagnostics !== undefined) {
        await attachWebhookTriggerDiagnostics({
          attach: params.attach,
          client,
          deliveryIds: webhookDiagnostics.deliveryIds,
          source: webhookDiagnostics.source,
          workspaceId: suite.workspaceId,
        });
      }

      const fetchedLogKeys = new Set(
        logRequirements.map((requirement) => `${requirement.stepId}:${requirement.attempt}`),
      );
      for (const request of collectStepLogAttachmentRequests(runDetail)) {
        const key = `${request.stepId}:${request.attempt}`;
        if (fetchedLogKeys.has(key)) continue;
        await params.attach(await fetchLogAttachment(request, token));
      }
    }

    return allMismatches;
  } catch (error) {
    if (webhookDiagnostics !== undefined) {
      await attachWebhookTriggerDiagnostics({
        attach: params.attach,
        client,
        deliveryIds: webhookDiagnostics.deliveryIds,
        source: webhookDiagnostics.source,
        workspaceId: suite.workspaceId,
      });
    }
    if (runnerLogFile !== undefined) await attachLocalRunnerLog(params.attach, runnerLogFile);
    throw error;
  } finally {
    if (runner !== undefined) {
      await stopLocalRunner(runner).catch((error: unknown) => {
        process.stderr.write(`platform-e2e: stopLocalRunner failed: ${String(error)}\n`);
      });
    }
  }
}
