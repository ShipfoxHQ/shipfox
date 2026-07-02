import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {waitForDefinition} from '@shipfox/e2e-helper-definitions';
import {commitFiles, createRepo} from '@shipfox/e2e-helper-integrations-gitea';
import {fetchStepLogs} from '@shipfox/e2e-helper-logs';
import {waitForRunByCommit, waitForRunTerminal} from '@shipfox/e2e-helper-workflows';
import {createProject, giteaExternalRepositoryId} from './create-project.js';
import {evaluateExpectations, evaluateLogs, logText, type Mismatch} from './expect.js';
import type {Scenario} from './scenarios.js';
import type {SuiteContext} from './suite-context.js';

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
  const repo = `${scenario.name}-${uniqueId}`;

  await createRepo({org: suite.org, name: repo});
  const project = await createProject({
    workspaceId: suite.workspaceId,
    sessionToken: token,
    name: repo,
    connectionId: suite.connectionId,
    externalRepositoryId: giteaExternalRepositoryId(suite.org, repo),
  });

  // Seed commit: the workflow plus any files/ contents. Its own push may or may not
  // dispatch a run (sync races its subscription creation); the suite ignores that and
  // correlates on the trigger below, after the definition is resolved.
  await commitFiles({
    org: suite.org,
    repo,
    message: `seed ${scenario.name}`,
    files: [
      {path: scenario.configPath, content: scenario.workflowYaml},
      ...scenario.extraFiles.map((file) => ({path: file.path, content: file.content})),
    ],
  });

  const definition = await waitForDefinition({
    projectId: project.id,
    configPath: scenario.configPath,
    token,
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
    // A second commit is the correlation key: its head SHA identifies exactly this
    // run, so the suite never depends on whether the seed push dispatched.
    const triggerSha = await commitFiles({
      org: suite.org,
      repo,
      message: `trigger ${scenario.name} ${uniqueId}`,
      files: [{path: '.shipfox-e2e-trigger', content: `${scenario.name} ${uniqueId}\n`}],
    });
    const run = await waitForRunByCommit({projectId: project.id, headCommitSha: triggerSha, token});
    runId = run.id;
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
    const logs = await fetchStepLogs({
      stepId: requirement.stepId,
      attempt: requirement.attempt,
      token,
    });
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
  }

  return allMismatches;
}
