import type {SessionViewRowMeta} from '@shipfox/api-logs-dto';
import type {AgentMessage, SessionEntry} from '../entry-schema.js';
import {
  booleanField,
  field,
  formatCount,
  isMeta,
  metaItem,
  numberField,
  stringField,
  stringifyValue,
} from '../object.js';
import {messageText} from './text.js';

export function sessionDetail(entry: SessionEntry): string | null {
  const version = numberField(entry, 'version');
  const id = stringField(entry, 'id') ?? stringField(entry, 'sessionId');
  const cwd = stringField(entry, 'cwd');
  return (
    [version == null ? null : `v${version}`, id, cwd].filter(Boolean).join(' · ') ||
    entryDetail(entry)
  );
}

export function modelChangeDetail(entry: SessionEntry): string | null {
  const model =
    stringField(entry, 'model') ?? stringField(entry, 'to') ?? stringField(entry, 'modelId');
  const provider = stringField(entry, 'provider');
  return [model, provider].filter(Boolean).join(' · ') || entryDetail(entry);
}

export function compactionDetail(entry: SessionEntry | AgentMessage): string | null {
  return stringField(entry, 'summary') ?? stringField(entry, 'message') ?? entryDetail(entry);
}

export function compactionMeta(entry: SessionEntry | AgentMessage): readonly SessionViewRowMeta[] {
  const tokensBefore = numberField(entry, 'tokensBefore');
  return [
    tokensBefore == null ? null : metaItem('tokens before', formatCount(tokensBefore, 'token')),
  ].filter(isMeta);
}

export function branchSummaryDetail(entry: SessionEntry | AgentMessage): string | null {
  return stringField(entry, 'summary') ?? stringField(entry, 'message') ?? entryDetail(entry);
}

export function branchSummaryMeta(
  entry: SessionEntry | AgentMessage,
): readonly SessionViewRowMeta[] {
  const fromId = stringField(entry, 'fromId');
  return [fromId == null ? null : metaItem('from', fromId)].filter(isMeta);
}

export function customEntryLabel(fallback: string): string {
  return fallback;
}

export function customEntryMeta(entry: SessionEntry | AgentMessage): readonly SessionViewRowMeta[] {
  const display = field(entry, 'display');
  return [
    metaItem('type', stringField(entry, 'customType')),
    typeof display === 'boolean' ? metaItem('display', display ? 'on' : 'off') : null,
  ].filter(isMeta);
}

export function customEntryText(entry: SessionEntry | AgentMessage): string | null {
  const text = messageText(entry);
  if (text) return text;

  const data = field(entry, 'data') ?? field(entry, 'details');
  return data === undefined ? entryDetail(entry) : stringifyValue(data);
}

export function bashExecutionMeta(message: AgentMessage): readonly SessionViewRowMeta[] {
  const exitCode = field(message, 'exitCode');
  return [
    typeof exitCode === 'number' ? metaItem('exit', String(exitCode)) : null,
    booleanField(message, 'cancelled') ? metaItem('cancelled', 'yes') : null,
    booleanField(message, 'truncated') ? metaItem('truncated', 'yes') : null,
    booleanField(message, 'excludeFromContext') ? metaItem('context', 'excluded') : null,
    metaItem('full output', stringField(message, 'fullOutputPath'), false),
  ].filter(isMeta);
}

export function labelDetail(entry: SessionEntry): string | null {
  return stringField(entry, 'label') ?? entryDetail(entry);
}

export function labelMeta(entry: SessionEntry): readonly SessionViewRowMeta[] {
  const targetId = stringField(entry, 'targetId');
  return [targetId == null ? null : metaItem('target', targetId, false)].filter(isMeta);
}

export function assistantMeta(message: AgentMessage): readonly SessionViewRowMeta[] {
  return [
    providerModelMeta(message),
    metaItem('api', stringField(message, 'api'), false),
    usageMeta(message),
    costMeta(message),
    stopReasonMeta(message),
  ].filter(isMeta);
}

export function messageMeta(message: AgentMessage): readonly SessionViewRowMeta[] {
  return [stopReasonMeta(message)].filter(isMeta);
}

function providerModelMeta(message: AgentMessage): SessionViewRowMeta | null {
  const model = stringField(message, 'model') ?? stringField(message, 'modelId');
  const provider = stringField(message, 'provider');
  const value = [provider, model].filter(Boolean).join('/');
  return value ? metaItem('model', value) : null;
}

function usageMeta(message: AgentMessage): SessionViewRowMeta | null {
  const usage = field(message, 'usage');
  const totalTokens = numberField(usage, 'totalTokens');
  return totalTokens == null ? null : metaItem('tokens', formatCount(totalTokens, 'token'));
}

function costMeta(message: AgentMessage): SessionViewRowMeta | null {
  const usage = field(message, 'usage');
  const cost = field(usage, 'cost');
  const total = numberField(cost, 'total');
  return total == null ? null : metaItem('cost', `$${total.toFixed(total < 0.01 ? 4 : 2)}`);
}

function stopReasonMeta(message: AgentMessage): SessionViewRowMeta | null {
  const stopReason = stringField(message, 'stopReason');
  return stopReason == null ? null : metaItem('stop', stopReason);
}

export function entryDetail(entry: SessionEntry | AgentMessage): string | null {
  const detail =
    stringField(entry, 'message') ??
    stringField(entry, 'text') ??
    stringField(entry, 'content') ??
    stringField(entry, 'summary') ??
    stringField(entry, 'label') ??
    stringField(entry, 'thinkingLevel') ??
    stringField(entry, 'level') ??
    stringField(entry, 'reason');
  if (detail) return detail;

  const value = field(entry, 'data') ?? field(entry, 'payload');
  if (value === undefined) return null;
  return stringifyValue(value);
}
