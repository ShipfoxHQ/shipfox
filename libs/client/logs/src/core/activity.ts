import type {SessionViewRow} from './log-model.js';
import type {
  GroupLogNode,
  LogNode,
  MarkerLogNode,
  OutputLogNode,
  SessionLogNode,
} from './log-tree.js';
import {nativeActionPresentation, nativeShellExitCode} from './native-tools.js';
import {piMcpProxySearchPresentation, unwrapPiMcpProxyAction} from './pi-mcp-proxy.js';
import {shipfoxActionPresentation, shipfoxOutputRejected} from './shipfox-tools.js';

export type ActivityState = 'running' | 'succeeded' | 'failed' | 'no-result';
export type ActionIconKind =
  | 'tool'
  | 'unknown'
  | 'file'
  | 'edit'
  | 'write'
  | 'shell'
  | 'search'
  | 'list'
  | 'web'
  | 'output'
  | 'integration';
export type ActionDetailKind = 'code' | 'markdown' | 'structured';
export type ActionReadClassification = 'read' | 'write' | 'unknown';

/**
 * The intentionally small contract used by Activity rows. Native and integration adapters can
 * provide this later without making the pairing transform aware of provider payloads.
 */
export interface ActionPresentation {
  label: string;
  target: string | null;
  iconKind: ActionIconKind;
  detailKind: ActionDetailKind;
  readClassification?: ActionReadClassification | undefined;
  statusDetail?: string | undefined;
  detail?: {label: string; value: string; kind: ActionDetailKind} | null;
  integration?:
    | {
        provider: string;
        connectionId: string;
        connectionSlug: string;
        toolId: string;
        methodId: string | null;
      }
    | undefined;
}

export interface PairedAction {
  key: number;
  request: Extract<SessionViewRow, {kind: 'tool-call'}> | null;
  result: Extract<SessionViewRow, {kind: 'tool-result'}> | null;
  requestSeq: number | null;
  resultSeq: number | null;
  sourceSeqs: readonly number[];
  timestamp: number;
  lineNumber: number;
  state: ActivityState;
  durationMs: number | null;
}

export type ActionPresentationLookup = (action: PairedAction) => ActionPresentation | undefined;

export type PairedSessionItem =
  | {kind: 'action'; action: PairedAction}
  | {kind: 'row'; seq: number; row: SessionViewRow; lineNumber: number};

export interface SessionRowSource {
  seq: number;
  lineNumber: number;
  row: SessionViewRow;
}

export interface ActivityActionNode {
  kind: 'action';
  seq: number;
  action: PairedAction;
}

export interface ActivityGroupNode extends Omit<GroupLogNode, 'children'> {
  children: ActivityNode[];
}

export interface ActivityReadGroupNode {
  kind: 'read-group';
  seq: number;
  children: ActivityActionNode[];
  totalCount: number;
}

export type ActivityNode =
  | OutputLogNode
  | MarkerLogNode
  | SessionLogNode
  | ActivityActionNode
  | ActivityReadGroupNode
  | ActivityGroupNode;

/** Pair tool rows by the request's source sequence, not by a display label or array index. */
export function pairSessionRows(
  rows: readonly SessionRowSource[],
  terminated = false,
): PairedSessionItem[] {
  const state: PairingState = {
    items: [],
    openById: new Map(),
    actionByRequestSeq: new Map(),
  };
  for (const source of rows) appendSessionSource(state, source);
  for (const item of state.items) finalizeAction(item, terminated);
  return state.items;
}

interface PairingState {
  items: PairedSessionItem[];
  openById: Map<string, number[]>;
  actionByRequestSeq: Map<number, PairedAction>;
}

function appendSessionSource(state: PairingState, source: SessionRowSource): void {
  if (source.row.kind === 'tool-call') {
    appendToolCall(state, source);
    return;
  }
  if (source.row.kind === 'tool-result') {
    appendToolResult(state, source);
    return;
  }
  state.items.push({kind: 'row', seq: source.seq, row: source.row, lineNumber: source.lineNumber});
}

function appendToolCall(state: PairingState, source: SessionRowSource): void {
  if (source.row.kind !== 'tool-call') return;
  const action: PairedAction = {
    key: source.seq,
    request: source.row,
    result: null,
    requestSeq: source.seq,
    resultSeq: null,
    sourceSeqs: [source.seq],
    timestamp: source.row.timestamp,
    lineNumber: source.lineNumber,
    state: 'running',
    durationMs: null,
  };
  state.items.push({kind: 'action', action});
  state.actionByRequestSeq.set(source.seq, action);
  if (source.row.id === null) return;
  const open = state.openById.get(source.row.id) ?? [];
  open.push(source.seq);
  state.openById.set(source.row.id, open);
}

function appendToolResult(state: PairingState, source: SessionRowSource): void {
  if (source.row.kind !== 'tool-result') return;
  const requestSeq = latestOpenRequest(state.openById, source.row.toolCallId);
  const action = requestSeq === null ? undefined : state.actionByRequestSeq.get(requestSeq);
  if (action === undefined || action.request === null) {
    state.items.push({kind: 'action', action: createResultOnlyAction(source)});
    return;
  }
  action.result = source.row;
  action.resultSeq = source.seq;
  action.sourceSeqs = [action.requestSeq ?? action.key, source.seq];
  const exitCode = nativeShellExitCode(action.request.name, source.row.output);
  const rejected = shipfoxOutputRejected(action.request.name, source.row.output);
  action.state =
    source.row.isError || rejected || (exitCode !== null && exitCode !== 0)
      ? 'failed'
      : 'succeeded';
  action.durationMs = validDuration(action.request.timestamp, source.row.timestamp);
}

function finalizeAction(item: PairedSessionItem, terminated: boolean): void {
  if (item.kind === 'action' && item.action.result === null) {
    item.action.state = terminated ? 'no-result' : 'running';
  }
}

/**
 * The single resolution order for every Activity surface: unwrap Pi proxy calls, then the
 * attempt's integration lookup, Shipfox-owned tools, native tools, and finally the generic form.
 */
export function resolveActionPresentation(
  action: PairedAction,
  lookup?: ActionPresentationLookup,
): ActionPresentation {
  const subject = actionSubject(action);
  return (
    lookup?.(subject) ??
    shipfoxActionPresentation(subject) ??
    nativeActionPresentation(subject) ??
    piMcpProxySearchPresentation(action) ??
    genericActionPresentation(subject)
  );
}

function actionSubject(action: PairedAction): PairedAction {
  return unwrapPiMcpProxyAction(action) ?? action;
}

export function genericActionPresentation(action: PairedAction): ActionPresentation {
  const name = action.request?.name ?? action.result?.toolName ?? 'unknown tool';
  const summary = action.request?.summary?.trim();
  const input = action.request?.input?.trim();
  const target = summary || input || null;
  return {
    label: humanizeActionLabel(
      (name.startsWith('mcp__shipfox_integration_tools__')
        ? name.slice('mcp__shipfox_integration_tools__'.length)
        : name
      ).replace('__', ' · '),
    ),
    target,
    iconKind: action.request === null || name.includes('__') ? 'unknown' : 'tool',
    detailKind: 'code',
    readClassification: 'unknown',
  };
}

/** Build Activity nodes from the stored log tree while replacing request/result pairs. */
export function buildActivityNodes(nodes: readonly LogNode[], terminated = false): ActivityNode[] {
  const sessionRows = collectSessionRows(nodes);
  const pairedItems = pairSessionRows(sessionRows, terminated);
  const actionsBySeq = new Map<number, PairedAction>();
  const consumedResultSeqs = new Set<number>();
  for (const item of pairedItems) {
    if (item.kind !== 'action') continue;
    const actionSeq = item.action.requestSeq ?? item.action.resultSeq;
    if (actionSeq === null) continue;
    actionsBySeq.set(actionSeq, item.action);
    if (item.action.resultSeq !== null && item.action.requestSeq !== null) {
      consumedResultSeqs.add(item.action.resultSeq);
    }
  }

  return replaceSessionNodes(nodes, actionsBySeq, consumedResultSeqs);
}

/** Group only consecutive, classified, completed reads within the same log-tree level. */
export function groupActivityReads(
  nodes: readonly ActivityNode[],
  presentation?: ActionPresentationLookup,
): ActivityNode[] {
  const grouped: ActivityNode[] = [];
  let run: ActivityReadGroupNode | null = null;
  let runKey: string | null = null;

  for (const node of nodes) {
    if (node.kind === 'group') {
      grouped.push({...node, children: groupActivityReads(node.children, presentation)});
      run = null;
      runKey = null;
      continue;
    }
    if (node.kind !== 'action') {
      grouped.push(node);
      run = null;
      runKey = null;
      continue;
    }
    const key = readGroupKey(node.action, presentation);
    if (key === null) {
      grouped.push(node);
      run = null;
      runKey = null;
      continue;
    }
    if (run !== null && key === runKey) {
      run.children.push(node);
      run.totalCount += 1;
      continue;
    }
    run = {
      kind: 'read-group',
      seq: node.seq,
      children: [node],
      totalCount: 1,
    };
    grouped.push(run);
    runKey = key;
  }
  return grouped;
}

function readGroupKey(
  action: PairedAction,
  presentation?: ActionPresentationLookup,
): string | null {
  if (action.state !== 'succeeded' || action.request === null || action.result === null)
    return null;
  const details = resolveActionPresentation(action, presentation);
  if (details.readClassification !== 'read') return null;
  const connection = details.integration?.connectionId ?? null;
  const method = details.integration?.methodId ?? null;
  return JSON.stringify([actionSubject(action).request?.name ?? null, connection, method]);
}

function collectSessionRows(
  nodes: readonly LogNode[],
  rows: SessionRowSource[] = [],
): SessionRowSource[] {
  for (const node of nodes) {
    if (node.kind === 'session') {
      rows.push({seq: node.seq, lineNumber: node.lineNumber, row: node.record.row});
    } else if (node.kind === 'group') {
      collectSessionRows(node.children, rows);
    }
  }
  return rows;
}

function replaceSessionNodes(
  nodes: readonly LogNode[],
  actionsBySeq: ReadonlyMap<number, PairedAction>,
  consumedResultSeqs: ReadonlySet<number>,
): ActivityNode[] {
  return nodes.flatMap((node): ActivityNode[] => {
    if (node.kind === 'session') {
      const action = actionsBySeq.get(node.seq);
      if (action !== undefined) return [{kind: 'action', seq: action.key, action}];
      if (consumedResultSeqs.has(node.seq)) return [];
      return [node];
    }
    if (node.kind !== 'group') return [node];
    return [
      {
        ...node,
        children: replaceSessionNodes(node.children, actionsBySeq, consumedResultSeqs),
      },
    ];
  });
}

function latestOpenRequest(openById: Map<string, number[]>, id: string | null): number | null {
  if (id === null) return null;
  const open = openById.get(id);
  if (!open || open.length === 0) return null;
  const requestSeq = open.pop();
  if (open.length === 0) openById.delete(id);
  return requestSeq ?? null;
}

function createResultOnlyAction(source: SessionRowSource): PairedAction {
  if (source.row.kind !== 'tool-result')
    throw new Error('result-only action requires a tool result');
  return {
    key: source.seq,
    request: null,
    result: source.row,
    requestSeq: null,
    resultSeq: source.seq,
    sourceSeqs: [source.seq],
    timestamp: source.row.timestamp,
    lineNumber: source.lineNumber,
    state: source.row.isError ? 'failed' : 'succeeded',
    durationMs: null,
  };
}

function validDuration(start: number, end: number): number | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function humanizeActionLabel(value: string): string {
  const label = value.replace(/[_-]+/g, ' ').trim();
  if (!label) return 'Unknown tool';
  return label.replace(/\b\w/g, (character) => character.toUpperCase());
}
