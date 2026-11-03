import {
  type ActivityActionNode,
  type ActivityReadGroupNode,
  groupActivityReads,
  type PairedAction,
  pairSessionRows,
  type SessionRowSource,
  type SessionViewRow,
} from '@shipfox/client-logs';
import type {ConversationItem, TurnNotice} from './conversation.js';
import {type RunStarted, readRunStarted} from './run-started.js';

export type ToolNode = ActivityActionNode | ActivityReadGroupNode;

export type TranscriptEntry =
  | {kind: 'user'; key: string; text: string; queued: boolean}
  | {kind: 'agent'; key: string; text: string; stopped: boolean; streaming: boolean}
  | {kind: 'tools'; key: string; nodes: readonly ToolNode[]}
  // A write has its own row, so a run never hides in a group of reads.
  | {kind: 'run-started'; key: string; run: RunStarted}
  | {kind: 'notice'; key: string; notice: TurnNotice};

export interface BuildTranscriptParams {
  items: readonly ConversationItem[];
  queued: readonly ConversationItem[];
  /** Text of the running model call, which the stored reply replaces. */
  partialText: string;
  /** The turn that is still running. Calls of any other turn have ended. */
  runningTurnId: string | undefined;
}

// Each item holds a handful of rows, so this keeps row seqs unique and in timeline order.
const ROWS_PER_ITEM = 1_000;

const ABORTED_WITHOUT_TEXT = 'Assistant run was aborted.';

interface RowSource extends SessionRowSource {
  item: ConversationItem;
}

function rowSources(items: readonly ConversationItem[]): RowSource[] {
  const sources: RowSource[] = [];
  for (const item of items) {
    if (item.seq === null || !item.content) continue;
    const base = item.seq * ROWS_PER_ITEM;
    if (item.content.type === 'turn_notice') {
      // A notice has no rows. A placeholder keeps its place among them.
      sources.push({seq: base, lineNumber: base, row: noticePlaceholder(item), item});
      continue;
    }
    if (item.content.type !== 'rows') continue;
    item.content.rows.forEach((row, index) => {
      sources.push({seq: base + index, lineNumber: base + index, row, item});
    });
  }
  return sources;
}

function noticePlaceholder(item: ConversationItem): SessionViewRow {
  return {
    kind: 'lifecycle',
    timestamp: Date.parse(item.createdAt) || 0,
    label: 'turn notice',
    detail: null,
    meta: [],
    tone: 'default',
    terminalFailure: false,
  };
}

function isStopped(row: Extract<SessionViewRow, {kind: 'message'}>): boolean {
  return row.meta.some((entry) => entry.label === 'stop' && entry.value === 'aborted');
}

function agentEntry(
  key: string,
  row: Extract<SessionViewRow, {kind: 'message'}>,
): TranscriptEntry | undefined {
  const stopped = isStopped(row);
  const text = stopped && row.text === ABORTED_WITHOUT_TEXT ? '' : row.text;
  if (!text.trim() && !stopped) return undefined;
  return {kind: 'agent', key, text, stopped, streaming: false};
}

function userText(item: ConversationItem): string | undefined {
  if (item.content?.type !== 'rows') return undefined;
  const row = item.content.rows.find(
    (candidate) => candidate.kind === 'message' && candidate.role === 'user',
  );
  return row?.kind === 'message' ? row.text : undefined;
}

/** A call of a turn that ended reads as unknown, never as running, because a write may have applied. */
function settle(
  action: PairedAction,
  turnOf: ReadonlyMap<number, string | null>,
  running?: string,
) {
  if (action.state !== 'running' || action.requestSeq === null) return action;
  const turnId = turnOf.get(action.requestSeq);
  return turnId !== undefined && turnId !== null && turnId === running
    ? action
    : {...action, state: 'no-result' as const};
}

/** A bubble or a notice, for the rows the chat shows. */
function rowEntry(
  row: SessionViewRow,
  seq: number,
  item: ConversationItem | undefined,
): TranscriptEntry | undefined {
  if (item?.content?.type === 'turn_notice') {
    return {kind: 'notice', key: item.id, notice: item.content.notice};
  }
  if (row.kind !== 'message') return undefined;
  if (row.role === 'user' && item) {
    return {kind: 'user', key: item.id, text: row.text, queued: false};
  }
  return row.role === 'assistant' ? agentEntry(`agent-${seq}`, row) : undefined;
}

/**
 * Maps the timeline onto chat entries. Tool calls pair across items, so a result stored after
 * a later message still finds its call. Thinking, raw, lifecycle, system, and compaction rows
 * aren't shown in v1.
 */
export function buildTranscript(params: BuildTranscriptParams): TranscriptEntry[] {
  const sources = rowSources(params.items);
  const turnOf = new Map(sources.map((source) => [source.seq, source.item.turnId] as const));
  const itemOf = new Map(sources.map((source) => [source.seq, source.item] as const));
  const entries: TranscriptEntry[] = [];
  let tools: ActivityActionNode[] = [];

  const flushTools = () => {
    if (tools.length === 0) return;
    const nodes = groupActivityReads(tools).filter(
      (node): node is ToolNode => node.kind === 'action' || node.kind === 'read-group',
    );
    entries.push({kind: 'tools', key: `tools-${tools[0]?.seq ?? 0}`, nodes});
    tools = [];
  };

  for (const paired of pairSessionRows(sources)) {
    if (paired.kind === 'action') {
      const action = settle(paired.action, turnOf, params.runningTurnId);
      const run = readRunStarted(action);
      if (run) {
        flushTools();
        entries.push({kind: 'run-started', key: `run-started-${action.key}`, run});
        continue;
      }
      tools.push({kind: 'action', seq: action.key, action});
      continue;
    }
    const entry = rowEntry(paired.row, paired.seq, itemOf.get(paired.seq));
    if (!entry) continue;
    flushTools();
    entries.push(entry);
  }

  flushTools();

  if (params.partialText.trim()) {
    entries.push({
      kind: 'agent',
      key: 'partial',
      text: params.partialText,
      stopped: false,
      streaming: true,
    });
  }

  for (const item of params.queued) {
    const text = userText(item);
    if (text !== undefined) entries.push({kind: 'user', key: item.id, text, queued: true});
  }
  return entries;
}
