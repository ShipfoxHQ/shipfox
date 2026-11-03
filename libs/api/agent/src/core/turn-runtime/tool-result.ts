import {Buffer} from 'node:buffer';

/** The most a tool result stores. A model can't use more, and a re-read is cheap. */
export const TOOL_RESULT_MAX_BYTES = 64 * 1024;

const TRUNCATION_NOTICE = '\n[Result truncated at 64 KiB]';
const CLOSING_TAG = /<\/untrusted_data/gi;

function truncateUtf8(text: string, maxBytes: number): {text: string; truncated: boolean} {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return {text, truncated: false};
  let end = maxBytes;
  // Back up to the start of a character so the cut never leaves half of one.
  while (end > 0 && (bytes[end] ?? 0) >> 6 === 0b10) end -= 1;
  return {text: bytes.subarray(0, end).toString('utf8'), truncated: true};
}

/**
 * Caps text and wraps it as untrusted data. The wrapper is part of the stored bytes, so every
 * later prompt carries it. The text can't close the tag early, because its own closing tags are
 * defanged first. The caller passes a `source` that is already safe to put in an attribute.
 */
export function wrapUntrustedText(params: {
  source: string;
  text: string;
  maxBytes: number;
}): string {
  const defanged = params.text.replace(CLOSING_TAG, '<\\/untrusted_data');
  const open = `<untrusted_data source="${params.source}">\n`;
  const close = '\n</untrusted_data>';
  // The cap covers the stored bytes, so the wrapper and the notice come out of the budget.
  const budget =
    params.maxBytes -
    Buffer.byteLength(open) -
    Buffer.byteLength(close) -
    Buffer.byteLength(TRUNCATION_NOTICE);
  const {text, truncated} = truncateUtf8(defanged, budget);
  return `${open}${text}${truncated ? TRUNCATION_NOTICE : ''}${close}`;
}

/** Caps a tool result and wraps it as untrusted data. */
export function wrapToolResultText(params: {toolName: string; text: string}): string {
  const tool = params.toolName.replace(/[^A-Za-z0-9_.-]/g, '_');
  return wrapUntrustedText({
    source: `tool:${tool}`,
    text: params.text,
    maxBytes: TOOL_RESULT_MAX_BYTES,
  });
}
