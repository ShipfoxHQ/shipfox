import type {AgentMessage, ContentBlock} from '../entry-schema.js';
import {stringField, toJson} from '../object.js';

const MESSAGE_SUFFIX = /Message$/;
const CAMEL_CASE_BOUNDARY = /([a-z])([A-Z])/g;

export function normalizeRole(message: AgentMessage): string {
  const raw = message.role ?? message.type ?? 'message';
  return raw.replace(MESSAGE_SUFFIX, '').replace(CAMEL_CASE_BOUNDARY, '$1-$2').toLowerCase();
}

export function roleLabel(role: string): string {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  return role.replaceAll('-', ' ');
}

export function isToolResultMessage(message: AgentMessage): boolean {
  const role = normalizeRole(message);
  return typeof message.toolCallId === 'string' || role === 'tool' || role === 'tool-result';
}

export function isToolCallBlock(block: ContentBlock): boolean {
  const type = stringField(block, 'type');
  return type === 'toolCall' || type === 'tool_call' || type === 'tool-call';
}

export function isThinkingBlock(block: ContentBlock): boolean {
  const type = stringField(block, 'type');
  return type === 'thinking' || type === 'thought' || type === 'reasoning';
}

export function blockText(block: ContentBlock): string {
  if (stringField(block, 'type') === 'image') return imagePlaceholder(block);

  return (
    stringField(block, 'text') ??
    stringField(block, 'content') ??
    stringField(block, 'thinking') ??
    ''
  );
}

export function messageText(message: AgentMessage): string {
  if (typeof message.content === 'string') return message.content;

  const blocks = Array.isArray(message.content) ? message.content : [];
  if (blocks.length > 0) {
    return blocks
      .map((block) => blockText(block))
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

export function isTerminalStop(message: AgentMessage): boolean {
  return (
    message.errorMessage != null ||
    message.stopReason === 'error' ||
    message.stopReason === 'aborted'
  );
}

export function terminalStopDetail(message: AgentMessage): string | null {
  if (message.errorMessage) return message.errorMessage;
  if (message.stopReason === 'error') return 'Assistant stopped with an error.';
  if (message.stopReason === 'aborted') return 'Assistant run was aborted.';
  return null;
}

export function bashExecutionText(message: AgentMessage): string {
  const command = stringField(message, 'command');
  const output = stringField(message, 'output');

  return [`$ ${command ?? ''}`.trim(), output].filter(Boolean).join('\n') || toJson(message);
}

function imagePlaceholder(block: ContentBlock): string {
  const mimeType = stringField(block, 'mimeType');
  return mimeType == null ? '[image]' : `[${mimeType} image]`;
}
