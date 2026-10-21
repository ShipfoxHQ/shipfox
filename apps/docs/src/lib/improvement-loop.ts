import type {TemplateIcon} from './template-catalog/types';

// Script of the improvement loop diagram on the introduction page. Shippy AI goes through
// several cycles: it observes runs, proposes a change as a pull request, your team approves
// it, and the platform runs the better version. `buildFrames` turns the script into one
// snapshot per animation tick. Screen readers and the machine-readable export read the same
// cycles as sentences.

export const agentName = 'Shippy AI';

export type LoopStage = 'find' | 'ship' | 'improve';

export interface FeedEntry {
  id: number;
  stage: LoopStage;
  text: string;
}

export type RunStatus = 'succeeded' | 'failed';

export interface WorkflowMetric {
  label: string;
  improved: boolean;
}

export interface WorkflowRow {
  name: string;
  visible: boolean;
  /** The latest runs, oldest first. */
  runs: {id: number; status: RunStatus}[];
  metric?: WorkflowMetric;
}

export type PullRequestState = 'review' | 'approved';

export interface PullRequestFrame {
  number: number;
  title: string;
  state: PullRequestState;
}

export type ActiveConnector = 'observe' | 'propose' | 'merge';

export interface LoopFrame {
  feed: FeedEntry[];
  pullRequest?: PullRequestFrame;
  active?: ActiveConnector;
  workflows: WorkflowRow[];
  watchedWorkflows: number;
  watchedRuns: number;
}

interface Cycle {
  workflow: string;
  lines: {stage: LoopStage; text: string}[];
  pullRequest: {number: number; title: string};
  /** Failures the workflow shows while Shippy AI observes it. */
  failures?: number;
  /** What changes on the platform once the pull request merges. */
  effect: {addWorkflow: true; metric?: string} | {metric: string};
  summary: string;
}

const cycles: Cycle[] = [
  {
    workflow: 'alert-triage',
    lines: [
      {stage: 'find', text: '30 Sentry alerts a week, triaged by hand · suggest alert-triage'},
      {stage: 'ship', text: 'opened PR #41 · add the alert-triage workflow'},
    ],
    pullRequest: {number: 41, title: 'Add the alert-triage workflow'},
    effect: {addWorkflow: true, metric: '~$0.42/run'},
    summary:
      'It found 30 Sentry alerts a week triaged by hand and opened PR #41 to add an alert-triage workflow.',
  },
  {
    workflow: 'release-notes',
    lines: [
      {stage: 'improve', text: 'release-notes failed 3× at the changelog step · fixed in PR #52'},
    ],
    pullRequest: {number: 52, title: 'Fix the changelog step in release-notes'},
    failures: 3,
    effect: {metric: 'fixed'},
    summary:
      'After release-notes failed 3 times at the changelog step, it fixed the step in PR #52.',
  },
  {
    workflow: 'alert-triage',
    lines: [
      {
        stage: 'improve',
        text: 'alert-triage diagnosis: same checks on a smaller model · PR #57, −70% cost',
      },
    ],
    pullRequest: {number: 57, title: 'Use a smaller model for diagnosis'},
    effect: {metric: '~$0.12/run'},
    summary:
      'It moved the diagnosis step of alert-triage to a smaller model that passes the same checks, in PR #57, which cut the cost of a run from about $0.42 to $0.12.',
  },
  {
    workflow: 'ask-codebase',
    lines: [
      {stage: 'find', text: '12 code questions a week in Slack · suggest ask-codebase'},
      {stage: 'ship', text: 'opened PR #63 · add the ask-codebase workflow'},
    ],
    pullRequest: {number: 63, title: 'Add the ask-codebase workflow'},
    effect: {addWorkflow: true},
    summary:
      'It found 12 code questions a week in Slack and opened PR #63 to add an ask-codebase workflow.',
  },
  {
    workflow: 'pr-checks',
    lines: [{stage: 'improve', text: 'pr-checks spends 3 of 5 min in npm ci · cache it · PR #68'}],
    pullRequest: {number: 68, title: 'Cache dependencies in pr-checks'},
    effect: {metric: '2m 05s'},
    summary:
      'It saw pr-checks spend 3 of its 5 minutes installing dependencies and cached them in PR #68, which brought a run down to about 2 minutes.',
  },
];

// Every row has a fixed slot, so the platform does not change height when a workflow appears.
const initialWorkflows: {name: string; visible: boolean; metric?: string}[] = [
  {name: 'release-notes', visible: true},
  {name: 'pr-checks', visible: true, metric: '5m 12s'},
  {name: 'alert-triage', visible: false},
  {name: 'ask-codebase', visible: false},
];

export const platformTools: TemplateIcon[] = [
  'github',
  'sentry',
  'slack',
  'posthog',
  'linear',
  'notion',
];
export const watchedTools = 9;
export const moreToolsCount = watchedTools - platformTools.length;

export const feedLength = 4;
export const runWindow = 10;
const earlierRuns = 1180;

// Ticks per phase of a cycle. One tick is one animation beat.
const observeTicks = 3;
const settleTicks = 2;
const holdTicks = 5;

// The state the script plays on. Each phase of a cycle mutates it, then records a frame.
class LoopRecorder {
  readonly frames: LoopFrame[] = [];
  private readonly feed: FeedEntry[] = [];
  private readonly workflows: WorkflowRow[] = initialWorkflows.map(({name, visible, metric}) => ({
    name,
    visible,
    runs: [],
    metric: metric ? {label: metric, improved: false} : undefined,
  }));
  private pullRequest: PullRequestFrame | undefined;
  private nextRunId = 0;
  private nextFeedId = 0;
  private totalRuns = 0;
  private rotation = 0;

  run(name: string, status: RunStatus = 'succeeded') {
    const workflow = this.find(name);
    if (!workflow?.visible) return;
    workflow.runs = [...workflow.runs, {id: this.nextRunId++, status}].slice(-runWindow);
    this.totalRuns += 1;
  }

  // Work keeps running in the background: each tick, the next visible workflow runs once.
  ambientRun(skip?: string) {
    const candidates = this.workflows.filter((row) => row.visible && row.name !== skip);
    const workflow = candidates[this.rotation % candidates.length];
    this.rotation += 1;
    if (workflow) this.run(workflow.name);
  }

  log(line: {stage: LoopStage; text: string}) {
    this.feed.push({id: this.nextFeedId++, ...line});
    if (this.feed.length > feedLength) this.feed.shift();
  }

  propose(pullRequest: {number: number; title: string}, state: PullRequestState) {
    this.pullRequest = {...pullRequest, state};
  }

  apply(name: string, effect: Cycle['effect']) {
    const workflow = this.find(name);
    if (!workflow) return;
    if ('addWorkflow' in effect) {
      workflow.visible = true;
      workflow.metric = effect.metric ? {label: effect.metric, improved: false} : undefined;
    } else {
      workflow.metric = {label: effect.metric, improved: true};
    }
  }

  record(active?: ActiveConnector) {
    this.frames.push({
      feed: [...this.feed],
      pullRequest: this.pullRequest ? {...this.pullRequest} : undefined,
      active,
      workflows: this.workflows.map((row) => ({
        ...row,
        runs: [...row.runs],
        metric: row.metric ? {...row.metric} : undefined,
      })),
      watchedWorkflows: this.workflows.filter((row) => row.visible).length + 10,
      watchedRuns: earlierRuns + this.totalRuns,
    });
  }

  private find(name: string): WorkflowRow | undefined {
    return this.workflows.find((row) => row.name === name);
  }
}

function observe(recorder: LoopRecorder, cycle: Cycle) {
  for (let tick = 0; tick < observeTicks; tick += 1) {
    if (tick < (cycle.failures ?? 0)) {
      recorder.run(cycle.workflow, 'failed');
      recorder.ambientRun(cycle.workflow);
    } else {
      recorder.ambientRun();
    }
    recorder.record('observe');
  }
}

function proposeAndApprove(recorder: LoopRecorder, cycle: Cycle) {
  const [firstLine, ...otherLines] = cycle.lines;
  if (firstLine) recorder.log(firstLine);
  recorder.propose(cycle.pullRequest, 'review');
  recorder.record('propose');

  for (const line of otherLines) recorder.log(line);
  recorder.ambientRun();
  recorder.record();

  recorder.propose(cycle.pullRequest, 'approved');
  recorder.ambientRun();
  recorder.record();
}

function mergeAndSettle(recorder: LoopRecorder, cycle: Cycle) {
  recorder.apply(cycle.workflow, cycle.effect);
  recorder.run(cycle.workflow);
  recorder.record('merge');

  for (let tick = 0; tick < settleTicks; tick += 1) {
    recorder.run(cycle.workflow);
    recorder.ambientRun(cycle.workflow);
    recorder.record();
  }
}

export function buildFrames(): LoopFrame[] {
  const recorder = new LoopRecorder();
  for (const {name} of initialWorkflows) {
    for (let run = 0; run < 6; run += 1) recorder.run(name);
  }

  for (const cycle of cycles) {
    observe(recorder, cycle);
    proposeAndApprove(recorder, cycle);
    mergeAndSettle(recorder, cycle);
  }

  for (let tick = 0; tick < holdTicks; tick += 1) recorder.record();
  return recorder.frames;
}

export const loopCaption = `How ${agentName} improves your workflows`;

export const agentDescription = `${agentName} watches your workflows, the ${watchedTools} tools they connect to, and every run. Each change it makes reaches your team as a pull request, and the platform runs the new version once you approve it.`;

export const cycleDescriptions = cycles.map((cycle) => cycle.summary);

export function serializeImprovementLoop(): string {
  return [
    `${loopCaption}:`,
    '',
    agentDescription,
    '',
    ...cycleDescriptions.map((summary, index) => `${index + 1}. ${summary}`),
  ].join('\n');
}
