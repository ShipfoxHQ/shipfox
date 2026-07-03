import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {waitForDefinition} from '@shipfox/e2e-helper-definitions';
import {commitFiles, createRepo} from '@shipfox/e2e-helper-integrations-gitea';
import {fetchStepLogs} from '@shipfox/e2e-helper-logs';
import {
  type LocalRunnerHandle,
  mintManualRegistrationToken,
  startLocalRunner,
  stopLocalRunner,
} from '@shipfox/e2e-helper-runners';
import {waitForRunByCommit, waitForRunTerminal} from '@shipfox/e2e-helper-workflows';
import {createProject, giteaExternalRepositoryId} from './create-project.js';
import {evaluateExpectations, evaluateLogs, logText, type Mismatch} from './expect.js';
import type {Scenario} from './scenarios.js';
import {type SuiteContext, suiteRunDir} from './suite-context.js';

const GITEA_SOURCE_PLACEHOLDER = '__GITEA_SOURCE__';
const GITEA_REPOSITORY_PLACEHOLDER = '__GITEA_REPOSITORY__';
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';
const LOG_ATTACHMENT_NAME_PART_RE = /[^a-zA-Z0-9._-]+/g;

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

// Definition sync creates trigger subscriptions asynchronously, so a push can reach
// dispatch before a subscription exists. Each retry needs a fresh head SHA for correlation.
async function triggerPushAndAwaitRun(params: {
  org: string;
  repo: string;
  scenario: string;
  uniqueId: string;
  projectId: string;
  token: string;
}): Promise<string> {
  const maxAttempts = 8;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const triggerSha = await commitFiles({
      org: params.org,
      repo: params.repo,
      message: `trigger ${params.scenario} ${params.uniqueId} #${attempt}`,
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

/**
 * Drives one declarative scenario end to end: fresh repo and project, seed commit,
 * definition-resolved poll, trigger (push commit or fire-manual), terminal-run poll,
 * then expect.yaml evaluation. Returns every mismatch (empty means the scenario
 * matched) and attaches the run detail, the diff, and fetched logs when it did not.
 */
export async function runScenario(params: RunScenarioParams): Promise<Mismatch[]> {
  const {scenario, suite} = params;
  const token = suite.sessionToken;
  const client = createApiClient({token});

  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-${scenario.name}-${uniqueId}`;
  const repo = `${scenario.name}-${uniqueId}`;
  const workflowYaml = scenario.workflowYaml
    .replaceAll(GITEA_SOURCE_PLACEHOLDER, suite.connectionSlug)
    .replaceAll(GITEA_REPOSITORY_PLACEHOLDER, `${suite.org}/${repo}`)
    .replaceAll(RUNNER_LABEL_PLACEHOLDER, runnerLabel);

  let runner: LocalRunnerHandle | undefined;
  let runnerLogFile: string | undefined;

  try {
    await createRepo({org: suite.org, name: repo});
    const project = await createProject({
      workspaceId: suite.workspaceId,
      sessionToken: token,
      name: repo,
      connectionId: suite.connectionId,
      externalRepositoryId: giteaExternalRepositoryId(suite.org, repo),
    });

    // The seed push can race subscription creation; assertions use the explicit trigger below.
    await commitFiles({
      org: suite.org,
      repo,
      message: `seed ${scenario.name}`,
      files: [
        {path: scenario.configPath, content: workflowYaml},
        ...scenario.extraFiles.map((file) => ({path: file.path, content: file.content})),
      ],
    });

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
    runner = await startLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: token,
      registrationToken: registrationToken.raw_token,
      labels: [runnerLabel],
      logFile: runnerLogFile,
      workspaceRoot: join(runDir, 'runner-workspaces', runnerLabel),
    });

    let runId: string;
    if (scenario.expectation.trigger === 'manual') {
      const response = await client.requestJson<FireManualTriggerResponseDto>(
        'post',
        `/workflow-definitions/${definition.id}/fire-manual`,
        {json: {inputs: scenario.expectation.inputs ?? {}}},
      );
      runId = response.workflow_run_id;
    } else {
      runId = await triggerPushAndAwaitRun({
        org: suite.org,
        repo,
        scenario: scenario.name,
        uniqueId,
        projectId: project.id,
        token,
      });
    }

    const runDetail = await waitForRunTerminal({
      runId,
      token,
      timeoutMs: scenario.expectation.timeout_seconds * 1000,
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
