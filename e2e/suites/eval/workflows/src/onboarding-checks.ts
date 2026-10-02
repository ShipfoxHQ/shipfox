import {parseTemplateHeader, type TemplateHeader} from '@shipfox/workflow-templates/header';
import type {McpCallRecord} from './mcp-calls.js';
import {providerLabel} from './onboarding-prompt.js';
import type {OnboardingExpect} from './onboarding-schema.js';
import {endsWithQuestion, type OnboardingSessionResult} from './onboarding-session.js';
import type {WrittenFile} from './onboarding-workspace.js';
import {diffAgainstTemplate} from './template-fidelity.js';

const WORKFLOWS_PATH = '.shipfox/workflows/';
const YAML_FILE = /\.ya?ml$/u;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/gu;
const PLACEHOLDER = /replace-with-[A-Za-z0-9/-]+/u;
const MODEL_REFERENCE = /^\s*model\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/u;
const FILE_WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const TEMPLATE_TOOL = 'get_workflow_template';
const MAX_LISTED_DIFFERENCES = 5;
// Tools that change something outside the checkout. `create_dev_run` writes unless it is a dry run.
const WRITE_TOOLS = new Set(['cancel_workflow_run', 'fire_manual_trigger', 'rerun_workflow_run']);

export interface OnboardingCheck {
  id: string;
  passed: boolean;
  /** Why the check failed, or what it looked at. */
  detail?: string;
}

export interface DryRunOutcome {
  trigger: string;
  passed: boolean;
  detail?: string;
}

/**
 * What the runner learned from the stack after the session, because the agent's own calls say
 * nothing certain about it: the dry run of the written workflow, the workspace's models, and
 * the variant of the template the case expects.
 */
export interface OnboardingEvidence {
  dry_runs?: DryRunOutcome[];
  workspace_models?: string[];
  expected_yaml?: string;
}

export interface OnboardingGrade {
  checks: OnboardingCheck[];
  passed: boolean;
}

export interface GradeOnboardingRunOptions {
  expect: OnboardingExpect;
  session: Pick<OnboardingSessionResult, 'stop_reason' | 'final_message'>;
  transcript_jsonl: string;
  mcp_calls: McpCallRecord[];
  written_files: WrittenFile[];
  evidence: OnboardingEvidence;
}

function check(id: string, passed: boolean, detail?: string): OnboardingCheck {
  return {id, passed, ...(passed || detail === undefined ? {} : {detail})};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface TranscriptEntry {
  type?: string;
  subtype?: string;
  result?: string;
  timestamp?: string;
  message?: {content?: unknown};
}

function parseTranscript(jsonl: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) entries.push(parsed as TranscriptEntry);
    } catch {
      // A line the driver could not write whole says nothing the graders need.
    }
  }
  return entries;
}

/**
 * The turns in which the agent ended by asking the user something, read from the transcript.
 * That is the criterion the driver stops on. One message counts once, however many question
 * marks it holds, because the skills ask for one question per message.
 */
export function countQuestions(transcriptJsonl: string): number {
  return parseTranscript(transcriptJsonl).filter(
    (entry) =>
      entry.type === 'result' &&
      entry.subtype === 'success' &&
      typeof entry.result === 'string' &&
      endsWithQuestion(entry.result),
  ).length;
}

function writesWorkflowFile(block: unknown): boolean {
  if (!(isRecord(block) && block.type === 'tool_use')) return false;
  const input = isRecord(block.input) ? block.input : {};
  const path = typeof input.file_path === 'string' ? input.file_path : '';
  return FILE_WRITING_TOOLS.has(String(block.name)) && path.includes(WORKFLOWS_PATH);
}

/** When the agent first tried to write a workflow file with a file tool, if it did. */
function firstWorkflowWriteAt(entries: TranscriptEntry[]): number | undefined {
  for (const entry of entries) {
    const content = entry.message?.content;
    if (entry.type !== 'assistant' || !Array.isArray(content) || entry.timestamp === undefined) {
      continue;
    }
    if (content.some(writesWorkflowFile)) return Date.parse(entry.timestamp);
  }
  return undefined;
}

/** The workflow file to grade: the one with a template header, else the first. */
export function primaryWorkflowFile(files: WrittenFile[]): WrittenFile | undefined {
  return (
    files.find((file) => parseTemplateHeader(file.content) !== undefined) ??
    files.find((file) => YAML_FILE.test(file.path)) ??
    files[0]
  );
}

function isWriteCall(call: McpCallRecord): boolean {
  if (call.method !== 'tools/call' || call.tool === undefined) return false;
  if (WRITE_TOOLS.has(call.tool)) return true;
  const args = isRecord(call.arguments) ? call.arguments : {};
  return call.tool === 'create_dev_run' && args.dry_run !== true;
}

function namesProvider(message: string, provider: string): boolean {
  const names = [provider, providerLabel(provider)].map((name) =>
    name.replace(REGEX_SPECIALS, '\\$&'),
  );
  return new RegExp(`\\b(?:${names.join('|')})\\b`, 'iu').test(message);
}

function modelReferences(yaml: string): string[] {
  return yaml.split('\n').flatMap((line) => {
    const match = MODEL_REFERENCE.exec(line);
    const model = match?.[1] ?? match?.[2] ?? match?.[3];
    return model === undefined || model.includes('${{') ? [] : [model];
  });
}

function sortedPairs(record: Record<string, string> | undefined): string {
  return JSON.stringify(Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

interface RecordedHeader {
  template: string;
  bindings: Record<string, string>;
  /** Absent for the legacy header, which records none. */
  options?: Record<string, string>;
}

/** The legacy header has no namespace, because only first-party templates used it. */
function recordedHeader(header: TemplateHeader): RecordedHeader {
  if ('legacy' in header) {
    return {template: `shipfox/${header.legacy.id}`, bindings: {...header.legacy.bindings}};
  }
  return {
    template: `${header.ref.namespace}/${header.ref.name}`,
    bindings: {...header.bindings},
    options: {...header.options},
  };
}

function headerMismatch({
  recorded,
  expected,
}: {
  recorded: RecordedHeader;
  expected: OnboardingExpect;
}): string | undefined {
  if (recorded.template !== expected.template) {
    return `The header names ${recorded.template}, not ${expected.template}.`;
  }
  if (sortedPairs(recorded.bindings) !== sortedPairs(expected.bindings)) {
    return `The header binds ${sortedPairs(recorded.bindings)}, not ${sortedPairs(expected.bindings)}.`;
  }
  // The fidelity check reads the options of a legacy header from the workflow body.
  for (const [option, choice] of Object.entries(expected.options ?? {})) {
    const recordedChoice = recorded.options?.[option];
    if (recorded.options !== undefined && recordedChoice !== choice) {
      return `The header records ${option}=${recordedChoice}, not ${choice}.`;
    }
  }
  return undefined;
}

function checkHeader({
  expected,
  file,
}: {
  expected: OnboardingExpect;
  file: WrittenFile;
}): OnboardingCheck {
  const header = parseTemplateHeader(file.content);
  if (header === undefined) return check('header', false, 'The workflow has no template header.');
  const mismatch = headerMismatch({recorded: recordedHeader(header), expected});
  return check('header', mismatch === undefined, mismatch);
}

function checkTemplateFetch({
  expected,
  calls,
  entries,
}: {
  expected: OnboardingExpect;
  calls: McpCallRecord[];
  entries: TranscriptEntry[];
}): OnboardingCheck {
  const name = (expected.template ?? '').split('/').at(-1);
  const fetched = calls.filter((call) => {
    const args = isRecord(call.arguments) ? call.arguments : {};
    return (
      call.tool === TEMPLATE_TOOL &&
      call.status === 'ok' &&
      (args.template_id === name || args.template_id === expected.template)
    );
  });
  const first = fetched.map((call) => Date.parse(call.startedAt)).sort((a, b) => a - b)[0];
  if (first === undefined) {
    return check('template_fetch', false, `${TEMPLATE_TOOL} was not called for ${name}.`);
  }
  const wroteAt = firstWorkflowWriteAt(entries);
  if (wroteAt !== undefined && first > wroteAt) {
    return check(
      'template_fetch',
      false,
      `${TEMPLATE_TOOL} was called after the file was written.`,
    );
  }
  return check('template_fetch', true);
}

function checkFidelity({
  evidence,
  file,
}: {
  evidence: OnboardingEvidence;
  file: WrittenFile;
}): OnboardingCheck {
  if (evidence.expected_yaml === undefined) {
    return check('template_fidelity', false, 'The expected template variant was not composed.');
  }
  const differences = diffAgainstTemplate({
    expectedYaml: evidence.expected_yaml,
    writtenYaml: file.content,
  });
  if (differences.length === 0) return check('template_fidelity', true);
  const listed = differences
    .slice(0, MAX_LISTED_DIFFERENCES)
    .map((difference) => `${difference.kind === 'missing' ? '-' : '+'} ${difference.line.trim()}`);
  const rest = differences.length - listed.length;
  return check(
    'template_fidelity',
    false,
    [...listed, ...(rest > 0 ? [`and ${rest} more`] : [])].join('\n'),
  );
}

function checkDryRun(evidence: OnboardingEvidence): OnboardingCheck {
  const runs = evidence.dry_runs ?? [];
  if (runs.length === 0) return check('dry_run', false, 'No dry run was made.');
  const failed = runs.filter((run) => !run.passed);
  if (failed.length === 0) return check('dry_run', true);
  return check(
    'dry_run',
    false,
    failed.map((run) => `${run.trigger}: ${run.detail ?? 'check_passed was not true'}`).join('\n'),
  );
}

function checkModels({
  evidence,
  file,
}: {
  evidence: OnboardingEvidence;
  file: WrittenFile;
}): OnboardingCheck {
  const known = new Set(evidence.workspace_models ?? []);
  const unknown = modelReferences(file.content).filter((model) => !known.has(model));
  if (unknown.length === 0) return check('models_in_catalog', true);
  return check(
    'models_in_catalog',
    false,
    `Not in the catalog: ${[...new Set(unknown)].join(', ')}.`,
  );
}

/** A case without a `template` is one where the user declined every template. */
function checkNoTemplateHeader(files: WrittenFile[]): OnboardingCheck {
  const derived = files.filter((written) => parseTemplateHeader(written.content) !== undefined);
  return check(
    'no_template_header',
    derived.length === 0,
    `Carries a template header: ${derived.map((written) => written.path).join(', ')}.`,
  );
}

function validatedChecks(
  options: GradeOnboardingRunOptions,
  entries: TranscriptEntry[],
): OnboardingCheck[] {
  const {expect: expected, written_files: files, evidence} = options;
  const file = primaryWorkflowFile(files);
  if (file === undefined) {
    return [check('workflow_file', false, `No file was written under ${WORKFLOWS_PATH}.`)];
  }
  const checks = [
    check('workflow_file', true),
    checkDryRun(evidence),
    check(
      'no_placeholder',
      !files.some((written) => PLACEHOLDER.test(written.content)),
      'A replace-with-* placeholder is left in the workflow.',
    ),
    checkModels({evidence, file}),
  ];
  if (expected.template === undefined) {
    return [...checks, checkNoTemplateHeader(files)];
  }
  return [
    ...checks,
    checkHeader({expected, file}),
    checkTemplateFetch({expected, calls: options.mcp_calls, entries}),
    checkFidelity({evidence, file}),
  ];
}

function stoppedChecks(
  options: GradeOnboardingRunOptions,
  entries: TranscriptEntry[],
): OnboardingCheck[] {
  const {expect: expected, written_files: files, mcp_calls: calls, session} = options;
  const writeTools = calls.filter(isWriteCall).map((call) => call.tool);
  // A file the agent wrote and then deleted is a write too, so the transcript counts as well.
  const attempted = firstWorkflowWriteAt(entries) !== undefined;
  const checks = [
    check(
      'no_workflow_file',
      files.length === 0 && !attempted,
      files.length === 0
        ? 'The agent wrote a workflow file and removed it.'
        : `Written: ${files.map((file) => file.path).join(', ')}.`,
    ),
    check('no_write_tool', writeTools.length === 0, `Called: ${writeTools.join(', ')}.`),
  ];
  if (expected.outcome !== 'blocked_on_connection' || expected.missing_provider === undefined) {
    return checks;
  }
  return [
    ...checks,
    check(
      'names_missing_provider',
      namesProvider(session.final_message, expected.missing_provider),
      `The final message does not name ${expected.missing_provider}.`,
    ),
  ];
}

/**
 * Grades one onboarding repeat. A check runs only when it applies to the case's outcome and,
 * for the template checks, to its `template`. The run passes when every applicable check does.
 *
 * Two checks of the design are covered by others. A connection the workspace lacks fails the dry
 * run, because the server compiles the workflow against the workspace's connections. A question
 * the repository answers takes a judge, so it is not a code check.
 */
export function gradeOnboardingRun(options: GradeOnboardingRunOptions): OnboardingGrade {
  const {expect: expected, session} = options;
  const entries = parseTranscript(options.transcript_jsonl);
  const questions = countQuestions(options.transcript_jsonl);
  const checks = [
    // A session cut off at a limit never reached the end a correct agent reaches.
    check(
      'ended_on_its_own',
      session.stop_reason === 'completed',
      `The session stopped at ${session.stop_reason}.`,
    ),
    ...(expected.outcome === 'validated'
      ? validatedChecks(options, entries)
      : stoppedChecks(options, entries)),
    ...(expected.max_questions === undefined
      ? []
      : [
          check(
            'max_questions',
            questions <= expected.max_questions,
            `The agent asked ${questions} questions, over ${expected.max_questions}.`,
          ),
        ]),
  ];
  return {checks, passed: checks.every((entry) => entry.passed)};
}
