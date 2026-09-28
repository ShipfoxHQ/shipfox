import type {ToolContentBlockV1, ToolErrorV1} from '#contract.js';

/** What a `call` fake returns: the tool's structured content and its raw content blocks. */
export class FakeToolResult {
  readonly structured: unknown;
  readonly content: readonly ToolContentBlockV1[];

  constructor(params: {structured: unknown; content: readonly ToolContentBlockV1[]}) {
    this.structured = params.structured;
    this.content = params.content;
  }
}

/**
 * A successful tool result. The content defaults to one text block holding the JSON, as most
 * providers send. Pass `content` to fake a provider that answers in text only, with `null` as
 * the structured value.
 */
export function toolResult(
  structured: unknown,
  options: {content?: readonly ToolContentBlockV1[]} = {},
): FakeToolResult {
  const content =
    options.content ??
    (structured === null || structured === undefined
      ? []
      : [{type: 'text', text: JSON.stringify(structured)}]);
  return new FakeToolResult({structured: structured ?? null, content});
}

export interface ToolErrorOptions {
  code?: string;
  message?: string;
  reason?: string;
  retryAfterSeconds?: number;
  /** A write reached the provider but no answer came back. */
  outcomeUnknown?: boolean;
}

/** Thrown by a fake to fail the call. The action receives it as a `ToolCallError`. */
export class FakeToolError extends Error {
  readonly error: ToolErrorV1;

  constructor(error: ToolErrorV1) {
    super(error.message);
    this.name = 'FakeToolError';
    this.error = error;
  }
}

/**
 * A failed tool call, for example `throw toolError('rate-limited')` or
 * `throw toolError({outcomeUnknown: true})`.
 */
export function toolError(codeOrOptions: string | ToolErrorOptions = {}): FakeToolError {
  const options = typeof codeOrOptions === 'string' ? {code: codeOrOptions} : codeOrOptions;
  return new FakeToolError({
    code: options.code ?? 'tool-error',
    message: options.message ?? 'The fake tool failed.',
    ...(options.reason === undefined ? {} : {reason: options.reason}),
    ...(options.retryAfterSeconds === undefined
      ? {}
      : {retry_after_seconds: options.retryAfterSeconds}),
    outcome_unknown: options.outcomeUnknown ?? false,
  });
}

/** What a `download` fake returns: the file bytes, or the bytes with the provider's metadata. */
export type FakeToolFile =
  | Uint8Array
  | string
  | {bytes: Uint8Array | string; filename?: string; mediaType?: string};

/**
 * A fake for one tool. It receives the arguments as the action sent them. A `call` fake returns
 * `toolResult(...)` or a plain value, which is wrapped the same way. A `download` fake returns
 * the file. Either may throw `toolError(...)`.
 */
export type ToolFake = (args: Readonly<Record<string, unknown>>) => unknown;

/** Fakes by manifest alias, then by tool name as the action calls it (`tool` or `family.method`). */
export type ToolFakes = Readonly<Record<string, Readonly<Record<string, ToolFake>>>>;
