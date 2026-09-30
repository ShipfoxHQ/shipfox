import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from '@shipfox/e2e-core';
import {findCaseDirectories, matchesCase} from './discovery.js';
import type {McpCallRecord} from './mcp-calls.js';
import {startMcpProxy} from './mcp-proxy.js';
import {resolvePrompt} from './onboarding-prompt.js';
import {loadOnboardingCase, type OnboardingCase} from './onboarding-schema.js';
import {
  agentEnvironment,
  type OnboardingSessionResult,
  runOnboardingSession,
} from './onboarding-session.js';
import {
  arrangeOnboardingWorkspace,
  collectWorkflowFiles,
  type WrittenFile,
} from './onboarding-workspace.js';
import {createRunId} from './results.js';
import {createSimulatedUser} from './simulated-user.js';

const defaultCasesRoot = fileURLToPath(new URL('../cases/onboarding/', import.meta.url));

export interface DiscoveredOnboardingCase {
  id: string;
  directory: string;
  definition: OnboardingCase;
}

export async function discoverOnboardingCases(
  root = defaultCasesRoot,
  options: {filter?: string} = {},
): Promise<DiscoveredOnboardingCase[]> {
  const cases: DiscoveredOnboardingCase[] = [];
  for (const directory of await findCaseDirectories(root).catch(() => [])) {
    const id = relative(root, directory).split('\\').join('/');
    if (!matchesCase(id, options.filter)) continue;
    cases.push({
      id,
      directory,
      definition: await loadOnboardingCase(join(directory, 'case.yaml')),
    });
  }
  return cases;
}

/**
 * What one repeat leaves behind for the graders. `completed` means the session ran to a stop,
 * including at a turn or time limit; `error` means the case could not be run at all.
 */
export interface OnboardingCaseResult {
  case: string;
  repeat: number;
  status: 'completed' | 'error';
  error?: string;
  prompt: string;
  duration_ms: number;
  cost_usd: number;
  workspace_id?: string;
  session?: Omit<OnboardingSessionResult, 'transcript_jsonl'>;
  transcript_jsonl?: string;
  mcp_calls: McpCallRecord[];
  written_files: WrittenFile[];
}

export interface OnboardingRunOptions {
  caseFilter?: string;
  /** Overrides each case's `k`. */
  repeat?: number;
  /** Stops starting new repeats once the agents have spent this much. */
  maxCostUsd?: number;
  casesRoot?: string;
  resultsDirectory?: string;
  runId?: string;
  workDirectory?: string;
  env?: Record<string, string | undefined>;
  agentModel?: string;
  simulatorModel?: string;
}

export interface OnboardingRun {
  runId: string;
  directory: string;
  results: OnboardingCaseResult[];
}

async function executeRepeat({
  discovered,
  repeat,
  proxy,
  apiKey,
  env,
  agentModel,
  simulatorModel,
}: {
  discovered: DiscoveredOnboardingCase;
  repeat: number;
  proxy: Awaited<ReturnType<typeof startMcpProxy>>;
  apiKey: string;
  env: Record<string, string | undefined>;
  agentModel?: string | undefined;
  simulatorModel?: string | undefined;
}): Promise<OnboardingCaseResult> {
  const templateCase = discovered.definition;
  const startedAt = Date.now();
  const cleanups: Array<() => Promise<void>> = [];
  const prompt = resolvePrompt(templateCase.prompt);
  const result: OnboardingCaseResult = {
    case: discovered.id,
    repeat,
    status: 'error',
    prompt,
    duration_ms: 0,
    cost_usd: 0,
    mcp_calls: [],
    written_files: [],
  };

  try {
    const workspace = await arrangeOnboardingWorkspace({
      templateCase,
      caseDirectory: discovered.directory,
      proxy,
      cleanups,
    });
    result.workspace_id = workspace.workspaceId;
    const home = await mkdtemp(join(tmpdir(), 'eval-agent-home-'));
    cleanups.push(() => rm(home, {recursive: true, force: true}));

    const {transcript_jsonl, ...session} = await runOnboardingSession({
      prompt,
      cwd: workspace.cwd,
      mcpUrl: workspace.proxySession.url,
      simulatedUser: createSimulatedUser({
        persona: templateCase.persona,
        apiKey,
        ...(simulatorModel === undefined ? {} : {model: simulatorModel}),
      }),
      maxTurns: templateCase.max_turns,
      timeoutSeconds: templateCase.timeout_seconds,
      env: agentEnvironment({apiKey, home, path: env.PATH ?? ''}),
      ...(agentModel === undefined ? {} : {model: agentModel}),
    });
    result.session = session;
    result.transcript_jsonl = transcript_jsonl;
    result.cost_usd = session.usage.agent.cost_usd;
    result.mcp_calls = workspace.proxySession.calls();
    result.written_files = await collectWorkflowFiles(workspace.cwd);
    if (session.stop_reason === 'error') result.error = session.error ?? 'The session failed.';
    result.status = session.stop_reason === 'error' ? 'error' : 'completed';
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    result.duration_ms = Date.now() - startedAt;
  }
  return result;
}

function summaryMarkdown(run: OnboardingRun): string {
  const lines = [
    '# Onboarding eval results',
    '',
    `- Run: \`${run.runId}\``,
    `- Repeats: ${run.results.length}`,
    `- Errors: ${run.results.filter((result) => result.status === 'error').length}`,
    '',
    '| Case | Repeat | Status | Stop | Turns | Questions | MCP calls | Cost (USD) |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |',
  ];
  for (const result of run.results) {
    lines.push(
      `| \`${result.case}\` | ${result.repeat} | ${result.status} | ${result.session?.stop_reason ?? '-'} | ${result.session?.turns ?? '-'} | ${result.session?.questions.length ?? '-'} | ${result.mcp_calls.length} | ${result.cost_usd.toFixed(4)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function writeOnboardingResults(run: OnboardingRun): Promise<void> {
  for (const result of run.results) {
    const path = join(run.directory, result.case, `${result.repeat}.json`);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  }
  await mkdir(run.directory, {recursive: true});
  await writeFile(join(run.directory, 'summary.md'), summaryMarkdown(run));
}

async function requireCases(options: OnboardingRunOptions): Promise<DiscoveredOnboardingCase[]> {
  const discovered = await discoverOnboardingCases(
    options.casesRoot,
    options.caseFilter === undefined ? {} : {filter: options.caseFilter},
  );
  if (discovered.length === 0) {
    const selected = options.caseFilter ? ` matching "${options.caseFilter}"` : '';
    throw new Error(`No onboarding cases${selected} were found.`);
  }
  return discovered;
}

/** Whether the repeats so far have spent the run's budget, so no new repeat should start. */
export function outOfBudget({
  results,
  maxCostUsd,
}: {
  results: Array<{cost_usd: number}>;
  maxCostUsd: number | undefined;
}): boolean {
  if (maxCostUsd === undefined) return false;
  return results.reduce((total, result) => total + result.cost_usd, 0) >= maxCostUsd;
}

/**
 * Runs every onboarding case `k` times against the running stack, one at a time. The MCP proxy
 * lives for the whole run so the OAuth client is registered once.
 */
export async function runOnboardingSuite(
  options: OnboardingRunOptions = {},
): Promise<OnboardingRun> {
  const env = options.env ?? process.env;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required to run the onboarding suite.');
  const discovered = await requireCases(options);

  const runId = options.runId ?? createRunId();
  const run: OnboardingRun = {
    runId,
    directory: join(options.resultsDirectory ?? 'results', runId),
    results: [],
  };
  const proxy = await startMcpProxy({
    apiOrigin: config.API_URL,
    publicOrigin: config.API_PUBLIC_URL,
    origin: config.CLIENT_BASE_URL,
  });
  try {
    for (const entry of discovered) {
      const repeats = options.repeat ?? entry.definition.k;
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        if (outOfBudget({results: run.results, maxCostUsd: options.maxCostUsd})) break;
        run.results.push(
          await executeRepeat({
            discovered: entry,
            repeat,
            proxy,
            apiKey,
            env,
            agentModel: options.agentModel,
            simulatorModel: options.simulatorModel,
          }),
        );
      }
    }
  } finally {
    await proxy.close();
    await writeOnboardingResults(run);
  }
  return run;
}
