import {readFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  getOpenRouterCost,
  getScriptedManagedProviderRequests,
  registerOpenRouterManagedProvider,
  registerScriptedManagedProvider,
  type ScriptedManagedProviderEntry,
  type ScriptedManagedProviderRequest,
} from '@shipfox/e2e-setup-agent';
import {findCaseDirectories, matchesCase} from './discovery.js';
import type {CaseResult} from './results.js';
import {loadScriptedEntries} from './scripted.js';
import {type ConversationTurnRecord, gradeShippyConversation} from './shippy-checks.js';
import {
  listConversationItems,
  sendConversationMessage,
  summarizeTurn,
  waitForTurnEnd,
} from './shippy-conversation.js';
import {loadShippyCase, resolveRunReferences, type ShippyCase} from './shippy-schema.js';
import {
  arrangeShippyWorkspace,
  listRunIds,
  pageContextFor,
  type ShippyWorkspace,
} from './shippy-workspace.js';

const defaultCasesRoot = fileURLToPath(new URL('../cases/shippy/', import.meta.url));
const RUNNER_LOG_TAIL_LINES = 200;
const MAX_PROMPT_CHARACTERS = 2_000;

export interface DiscoveredShippyCase {
  id: string;
  directory: string;
  definition: ShippyCase;
  /** The model replies from `scripted.yaml`, which scripted mode needs. */
  script?: ScriptedManagedProviderEntry[] | undefined;
}

export async function discoverShippyCases(
  root = defaultCasesRoot,
  options: {filter?: string} = {},
): Promise<DiscoveredShippyCase[]> {
  const cases: DiscoveredShippyCase[] = [];
  for (const directory of await findCaseDirectories(root).catch(() => [])) {
    const id = relative(root, directory).split('\\').join('/');
    if (!matchesCase(id, options.filter)) continue;
    cases.push({
      id,
      directory,
      definition: await loadShippyCase(join(directory, 'case.yaml')),
      script: await loadScriptedEntries(join(directory, 'scripted.yaml')),
    });
  }
  return cases;
}

export interface ExecuteShippyCaseOptions {
  discovered: DiscoveredShippyCase;
  mode: 'scripted' | 'live';
  repeat: number;
  /** Runner logs and workspaces go below this directory. */
  workDirectory: string;
  /** Live mode: replaces the case's `live.model`. */
  model?: string | undefined;
}

/** Points the project's model calls at the script, or at OpenRouter for a live run. */
async function registerModelBackend({
  options,
  workspace,
}: {
  options: ExecuteShippyCaseOptions;
  workspace: ShippyWorkspace;
}): Promise<void> {
  const {discovered, mode} = options;
  if (mode === 'live') {
    await registerOpenRouterManagedProvider({
      projectId: workspace.projectId,
      defaultModel: options.model ?? discovered.definition.live.model,
    });
    return;
  }
  if (discovered.script === undefined) {
    throw new Error(`Case "${discovered.id}" has no scripted.yaml, which scripted mode needs.`);
  }
  await registerScriptedManagedProvider({
    projectId: workspace.projectId,
    entries: resolveRunReferences(discovered.script, workspace.runs),
  });
}

/** Sends each turn and waits for its reply, within the case's deadline. */
async function driveConversation({
  shippyCase,
  workspace,
  deadline,
}: {
  shippyCase: ShippyCase;
  workspace: ShippyWorkspace;
  deadline: number;
}): Promise<{conversationId: string; turns: ConversationTurnRecord[]}> {
  const turns: ConversationTurnRecord[] = [];
  let conversationId: string | undefined;
  let previousTurnId: string | null = null;
  for (const turn of shippyCase.turns) {
    conversationId = await sendConversationMessage({
      client: workspace.client,
      projectId: workspace.projectId,
      conversationId,
      body: turn.message,
      pageContext: pageContextFor(turn.page, workspace.runs),
    });
    const detail = await waitForTurnEnd({
      client: workspace.client,
      conversationId,
      previousTurnId,
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal: workspace.runner?.aborted,
    });
    const ended = detail.latest_turn;
    if (ended === null) throw new Error('The conversation ended with no turn.');
    previousTurnId = ended.id;
    const items = await listConversationItems({client: workspace.client, conversationId});
    turns.push(
      summarizeTurn({
        items,
        turnId: ended.id,
        message: turn.message,
        status: ended.status === 'running' ? 'missing' : ended.status,
        failureCode: ended.failure_code,
      }),
    );
  }
  if (conversationId === undefined) throw new Error('The case has no turns.');
  return {conversationId, turns};
}

/** A request the script had no reply for, one message each. */
function surpriseFailures(requests: ScriptedManagedProviderRequest[]): string[] {
  return requests
    .filter((request) => request.surprise)
    .map((request) => `Unexpected model request ${request.index}: ${request.error ?? 'no reply'}`);
}

async function attachFailureContext({
  result,
  workspace,
  mode,
}: {
  result: CaseResult;
  workspace: ShippyWorkspace;
  mode: 'scripted' | 'live';
}): Promise<void> {
  if (mode === 'scripted') {
    const requests = await getScriptedManagedProviderRequests({
      projectId: workspace.projectId,
    }).catch(() => undefined);
    if (requests !== undefined) {
      result.model_requests = requests.map((request) => ({
        ...request,
        prompt:
          request.prompt.length > MAX_PROMPT_CHARACTERS
            ? `...${request.prompt.slice(-MAX_PROMPT_CHARACTERS)}`
            : request.prompt,
      }));
    }
  }
  if (workspace.runner === undefined) return;
  const log = await readFile(workspace.runner.logFile, 'utf8').catch(() => undefined);
  if (log !== undefined) {
    result.runner_log_tail = log.trimEnd().split('\n').slice(-RUNNER_LOG_TAIL_LINES).join('\n');
  }
}

/**
 * Executes one Shippy case against the running stack: a workspace and project of their own, the
 * seeded runs, then the conversation, turn by turn. It never throws. A case that can't finish
 * is an `error` result with the reason.
 */
export async function executeShippyCase(options: ExecuteShippyCaseOptions): Promise<CaseResult> {
  const {discovered, mode, repeat, workDirectory} = options;
  const shippyCase = discovered.definition;
  const startedAt = Date.now();
  const cleanups: Array<() => Promise<void>> = [];
  const result: CaseResult = {
    case: discovered.id,
    mode,
    repeat,
    status: 'error',
    duration_ms: 0,
    cost_usd: 0,
  };
  let workspace: ShippyWorkspace | undefined;

  try {
    workspace = await arrangeShippyWorkspace({
      shippyCase,
      caseDirectory: discovered.directory,
      label: discovered.id,
      workDirectory,
      cleanups,
    });
    if (workspace.runner !== undefined) result.runner_log = workspace.runner.logFile;
    await registerModelBackend({options, workspace});

    const runsBefore = new Set(await listRunIds(workspace));
    const conversation = await driveConversation({
      shippyCase,
      workspace,
      deadline: startedAt + shippyCase.timeout_seconds * 1_000,
    });
    result.conversation = {id: conversation.conversationId, turns: conversation.turns};
    const newRunIds = (await listRunIds(workspace)).filter((runId) => !runsBefore.has(runId));

    const grade = gradeShippyConversation({
      expect: resolveRunReferences(shippyCase.expect, workspace.runs),
      turns: conversation.turns,
      newRunIds,
    });
    result.checks = grade.checks;
    const failures = grade.checks
      .filter((entry) => !entry.passed)
      .map((entry) => `${entry.id}: ${entry.detail ?? 'failed'}`);
    if (mode === 'scripted') {
      const requests = await getScriptedManagedProviderRequests({projectId: workspace.projectId});
      failures.push(...surpriseFailures(requests));
    }
    result.status = failures.length === 0 ? 'passed' : 'failed';
    if (failures.length > 0) result.error = failures.join('\n');
  } catch (error) {
    result.status = 'error';
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (mode === 'live' && workspace !== undefined) {
      result.cost_usd = await getOpenRouterCost({projectId: workspace.projectId})
        .then((cost) => cost.cost_usd)
        .catch(() => 0);
    }
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    if (result.status !== 'passed' && workspace !== undefined) {
      await attachFailureContext({result, workspace, mode});
    }
    result.duration_ms = Date.now() - startedAt;
  }
  return result;
}
