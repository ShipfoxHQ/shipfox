import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PageContextDto} from '@shipfox/api-agent-dto';
import type {WorkflowRunListResponseDto} from '@shipfox/api-workflows-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {getOpenRouterCost, registerOpenRouterManagedProvider} from '@shipfox/e2e-setup-agent';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {runAwait} from './awaits.js';
import {startCaseRunner} from './case-runner.js';
import {setRunnerLabel} from './compose.js';
import {createDefinition, fireManual} from './definitions.js';
import {findCaseDirectories, matchesCase} from './discovery.js';
import {createRunId, outOfBudget} from './results.js';
import {gradeShippyConversation, type ShippyCheck} from './shippy-checks.js';
import {ShippyConversation, type ShippyTranscript} from './shippy-conversation.js';
import {loadShippyCase, resolveRunReferences, type ShippyCase} from './shippy-schema.js';

const defaultCasesRoot = fileURLToPath(new URL('../cases/shippy/', import.meta.url));

/** The catalog model that answers Shippy, in place of the workspace default. */
export const DEFAULT_SHIPPY_MODEL = 'gpt-6-luna';

export interface DiscoveredShippyCase {
  id: string;
  directory: string;
  definition: ShippyCase;
}

export async function discoverShippyCases(
  root = defaultCasesRoot,
  options: {filter?: string} = {},
): Promise<DiscoveredShippyCase[]> {
  const cases: DiscoveredShippyCase[] = [];
  for (const directory of await findCaseDirectories(root).catch(() => [])) {
    const id = relative(root, directory).split('\\').join('/');
    if (!matchesCase(id, options.filter)) continue;
    cases.push({id, directory, definition: await loadShippyCase(join(directory, 'case.yaml'))});
  }
  return cases;
}

/** One repeat of one case. `completed` means the conversation ran; `error` means it could not. */
export interface ShippyCaseResult {
  case: string;
  repeat: number;
  status: 'completed' | 'error';
  error?: string;
  model: string;
  duration_ms: number;
  cost_usd: number;
  workspace_id?: string;
  conversation_id?: string;
  run_ids: Record<string, string>;
  turns?: ShippyTranscript['turns'];
  tool_calls?: ShippyTranscript['tool_calls'];
  tool_results?: ShippyTranscript['tool_results'];
  reply?: string;
  /** Absent when the conversation errored. */
  checks?: ShippyCheck[];
  passed?: boolean;
  items?: ShippyTranscript['items'];
}

export interface ShippyRunOptions {
  caseFilter?: string;
  /** Overrides each case's `k`. */
  repeat?: number;
  maxCostUsd?: number;
  /** The catalog model that answers Shippy. */
  model?: string;
  casesRoot?: string;
  resultsDirectory?: string;
  runId?: string;
  workDirectory?: string;
}

export interface ShippyRun {
  runId: string;
  directory: string;
  results: ShippyCaseResult[];
}

async function listRunIds(params: {
  client: ReturnType<typeof createApiClient>;
  projectId: string;
}): Promise<string[]> {
  const page = await params.client.requestJson<WorkflowRunListResponseDto>(
    'get',
    `/workflows/runs?project_id=${params.projectId}&limit=100`,
  );
  return page.runs.map((run) => run.id);
}

/** A workspace, a project, a runner, and the case's runs, so Shippy reads real runs and logs. */
async function arrangeCase(params: {
  discovered: DiscoveredShippyCase;
  model: string;
  workDirectory: string;
  cleanups: Array<() => Promise<void>>;
  result: ShippyCaseResult;
}) {
  const {discovered, result} = params;
  const shippyCase = discovered.definition;
  const uniqueId = randomUUID().slice(0, 8);
  const user = await createUser({name: `Eval ${uniqueId}`});
  const workspace = await createWorkspace({
    userId: user.user.id,
    userEmail: user.email,
    name: `Eval Shippy ${uniqueId}`,
  });
  result.workspace_id = workspace.id;
  const session = await createSession({user_id: user.user.id});
  const client = createApiClient({token: session.token});
  const project = await createProject({workspaceId: workspace.id, name: `Eval ${uniqueId}`});
  await registerOpenRouterManagedProvider({projectId: project.id, conversationModel: params.model});

  const runner = await startCaseRunner({
    workspaceId: workspace.id,
    userToken: session.token,
    uniqueId,
    workDirectory: params.workDirectory,
    cleanups: params.cleanups,
  });
  const definitions = new Map<string, string>();
  for (const [name, file] of Object.entries(shippyCase.workflows)) {
    const source = await readFile(join(discovered.directory, file), 'utf8');
    const definition = await createDefinition({
      client,
      projectId: project.id,
      yaml: setRunnerLabel({yaml: source, label: runner.label}),
    });
    definitions.set(name, definition.id);
  }
  const timeoutMs = shippyCase.timeout_seconds * 1_000;
  for (const seeded of shippyCase.runs) {
    const definitionId = definitions.get(seeded.workflow);
    if (definitionId === undefined) throw new Error(`No workflow named "${seeded.workflow}".`);
    const runId = await fireManual({client, definitionId, inputs: {}, signal: runner.aborted});
    result.run_ids[seeded.name] = runId;
    await runAwait({
      step: {run: seeded.status},
      runId,
      token: session.token,
      timeoutMs,
      signal: runner.aborted,
    });
  }
  return {client, projectId: project.id};
}

function pageContextFor(
  value: Record<string, string | number> | undefined,
  runIds: ReadonlyMap<string, string>,
): PageContextDto | undefined {
  if (value === undefined) return undefined;
  const resolved = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === 'string' ? resolveRunReferences(entry, runIds) : entry,
    ]),
  );
  // The API checks the shape, so a malformed context fails the case with its validation error.
  return resolved as PageContextDto;
}

async function executeRepeat(params: {
  discovered: DiscoveredShippyCase;
  repeat: number;
  model: string;
  workDirectory: string;
}): Promise<ShippyCaseResult> {
  const {discovered, repeat, model} = params;
  const shippyCase = discovered.definition;
  const startedAt = Date.now();
  const cleanups: Array<() => Promise<void>> = [];
  const result: ShippyCaseResult = {
    case: discovered.id,
    repeat,
    status: 'error',
    model,
    duration_ms: 0,
    cost_usd: 0,
    run_ids: {},
  };
  let projectId: string | undefined;
  try {
    const arranged = await arrangeCase({
      discovered,
      model,
      workDirectory: params.workDirectory,
      cleanups,
      result,
    });
    projectId = arranged.projectId;
    const runIds = new Map(Object.entries(result.run_ids));
    const runsBefore = new Set(await listRunIds(arranged));

    const conversation = new ShippyConversation(arranged);
    for (const message of shippyCase.messages) {
      await conversation.say({
        body: message.body,
        pageContext: pageContextFor(message.page_context, runIds),
        timeoutMs: shippyCase.timeout_seconds * 1_000,
      });
    }
    if (conversation.id !== undefined) result.conversation_id = conversation.id;
    const transcript = await conversation.transcript();
    result.turns = transcript.turns;
    result.tool_calls = transcript.tool_calls;
    result.tool_results = transcript.tool_results;
    result.reply = transcript.reply;
    result.items = transcript.items;

    const newRunIds = (await listRunIds(arranged)).filter((runId) => !runsBefore.has(runId));
    const expect = {
      ...shippyCase.expect,
      tool_input_contains: shippyCase.expect.tool_input_contains.map((text) =>
        resolveRunReferences(text, runIds),
      ),
    };
    const grade = gradeShippyConversation({expect, transcript, newRunIds});
    result.checks = grade.checks;
    result.passed = grade.passed;
    result.status = 'completed';
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (projectId !== undefined) {
      result.cost_usd = await getOpenRouterCost({projectId})
        .then((cost) => cost.cost_usd)
        .catch(() => 0);
    }
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    result.duration_ms = Date.now() - startedAt;
  }
  return result;
}

function passedCell(result: ShippyCaseResult): string {
  if (result.passed === undefined) return '-';
  return result.passed ? 'pass' : 'fail';
}

export function shippySummaryMarkdown(run: ShippyRun): string {
  const graded = run.results.filter((result) => result.passed !== undefined);
  const lines = [
    '# Shippy eval results',
    '',
    `- Run: \`${run.runId}\``,
    `- Model: \`${run.results[0]?.model ?? DEFAULT_SHIPPY_MODEL}\``,
    `- Repeats: ${run.results.length}`,
    `- Errors: ${run.results.filter((result) => result.status === 'error').length}`,
    `- Passed: ${graded.filter((result) => result.passed).length} of ${graded.length} graded`,
    '',
    '| Case | Repeat | Status | Result | Tool calls | Duration (s) | Cost (USD) |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: |',
  ];
  for (const result of run.results) {
    lines.push(
      `| \`${result.case}\` | ${result.repeat} | ${result.status} | ${passedCell(result)} | ${result.tool_calls?.length ?? '-'} | ${(result.duration_ms / 1_000).toFixed(1)} | ${result.cost_usd.toFixed(4)} |`,
    );
  }
  const failures = run.results.flatMap((result) =>
    (result.checks ?? []).filter((entry) => !entry.passed).map((entry) => ({result, check: entry})),
  );
  if (failures.length > 0) {
    lines.push('', '## Failed checks', '');
    for (const {result, check} of failures) {
      const detail = check.detail === undefined ? '' : `: ${check.detail.split('\n')[0]}`;
      lines.push(`- \`${result.case}\` repeat ${result.repeat}: \`${check.id}\`${detail}`);
    }
  }
  const errors = run.results.filter((result) => result.status === 'error');
  if (errors.length > 0) {
    lines.push('', '## Errors', '');
    for (const result of errors) {
      lines.push(`- \`${result.case}\` repeat ${result.repeat}: ${result.error ?? 'failed'}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function writeShippyResults(run: ShippyRun): Promise<void> {
  for (const result of run.results) {
    const path = join(run.directory, result.case, `${result.repeat}.json`);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  }
  await mkdir(run.directory, {recursive: true});
  await writeFile(join(run.directory, 'summary.md'), shippySummaryMarkdown(run));
}

/**
 * Runs every Shippy case `k` times against the running stack, one at a time. Shippy answers
 * through the OpenRouter backend of the managed provider, so the API needs
 * `E2E_OPENROUTER_API_KEY`.
 */
export async function runShippySuite(options: ShippyRunOptions = {}): Promise<ShippyRun> {
  const discovered = await discoverShippyCases(
    options.casesRoot,
    options.caseFilter === undefined ? {} : {filter: options.caseFilter},
  );
  if (discovered.length === 0) {
    const selected = options.caseFilter ? ` matching "${options.caseFilter}"` : '';
    throw new Error(`No Shippy cases${selected} were found.`);
  }
  const runId = options.runId ?? createRunId();
  const run: ShippyRun = {
    runId,
    directory: join(options.resultsDirectory ?? 'results', runId),
    results: [],
  };
  const model = options.model ?? DEFAULT_SHIPPY_MODEL;
  const workDirectory = options.workDirectory ?? join('.eval-run', runId);
  try {
    for (const {entry, repeat} of repeatsOf({discovered, repeat: options.repeat})) {
      if (outOfBudget({results: run.results, maxCostUsd: options.maxCostUsd})) break;
      run.results.push(await executeRepeat({discovered: entry, repeat, model, workDirectory}));
    }
  } finally {
    await writeShippyResults(run);
  }
  return run;
}

function* repeatsOf(params: {
  discovered: readonly DiscoveredShippyCase[];
  repeat: number | undefined;
}): Generator<{entry: DiscoveredShippyCase; repeat: number}> {
  for (const entry of params.discovered) {
    const repeats = params.repeat ?? entry.definition.k;
    for (let repeat = 1; repeat <= repeats; repeat += 1) yield {entry, repeat};
  }
}
