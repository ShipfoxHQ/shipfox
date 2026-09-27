import type {WorkflowRunListResponseDto} from '@shipfox/api-workflows-dto';
import {type createApiClient, pollUntil} from '@shipfox/e2e-core';
import {composeTemplate, loadShippedTemplates} from '@shipfox/workflow-templates';

export const REPORT_FAILURE_MARKER = 'report-failed-runs-e2e-failure';
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';
const optionMarker = /^\s*# option:(\w+)=(\w+) (begin|end)$/;
const selectedWorkflowPaths = /\[".shipfox\/workflows\/replace-with-workflow.yml"\]/;
// The suite shares one workspace, so the test scopes reports by workflow file instead of project.
const selections: Readonly<Record<string, string>> = {
  scope: 'workspace',
  workflow_filter: 'selected',
  include_cancelled: 'off',
  diagnosis: 'off',
};

export function failingWorkflowYaml(): string {
  return `name: Always fails
runner: ${RUNNER_LABEL_PLACEHOLDER}
triggers:
  manual:
    source: manual
jobs:
  fail:
    checkout: false
    steps:
      - name: Fail on purpose
        run: |
          echo "${REPORT_FAILURE_MARKER}"
          exit 1
`;
}

export function reportFailedRunsWorkflowYaml(params: {
  slackSlug: string;
  channel: string;
  workflowPaths: readonly string[];
}): string {
  const template = loadShippedTemplates().find(
    ({manifest}) => manifest.id === 'report-failed-runs',
  );
  if (template === undefined) throw new Error('The report template is not shipped');
  const open: boolean[] = [];
  const workflow = composeTemplate(template, {notify: 'slack'})
    .split('\n')
    .filter((line) => {
      const marker = optionMarker.exec(line);
      if (marker === null) return open.every(Boolean);
      if (marker[3] === 'begin') open.push(selections[marker[1] ?? ''] === marker[2]);
      else open.pop();
      return false;
    })
    .join('\n');
  if (!selectedWorkflowPaths.test(workflow)) throw new Error('The report has no workflow list');
  return workflow
    .replace(selectedWorkflowPaths, JSON.stringify(params.workflowPaths))
    .replace('runner: shipfox', `runner: ${RUNNER_LABEL_PLACEHOLDER}`)
    .replaceAll('slack_notify', params.slackSlug)
    .replace('replace-with-slack-channel-id', params.channel);
}

/** Waits for the report run that `run_name` names after the reported workflow run. */
export async function waitForReportRun(params: {
  client: ReturnType<typeof createApiClient>;
  projectId: string;
  name: string;
  timeoutMs: number;
}): Promise<string> {
  let seen: string[] = [];
  const run = await pollUntil(
    {
      timeoutMs: params.timeoutMs,
      intervalMs: 500,
      describe: () => `report run "${params.name}"; seen=${JSON.stringify(seen)}`,
    },
    async () => {
      const page = await params.client.requestJson<WorkflowRunListResponseDto>(
        'get',
        `/workflows/runs?project_id=${params.projectId}&trigger_source=shipfox&limit=100`,
      );
      seen = page.runs.map((candidate) => candidate.name);
      return page.runs.find((candidate) => candidate.name === params.name) ?? null;
    },
  );
  return run.id;
}
