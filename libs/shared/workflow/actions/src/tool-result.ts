import type {DownloadedFileV1, ToolContentBlockV1} from '#contract.js';

/**
 * The result of a tool call. Some providers return `structured` content; others, such as proxied
 * MCP tools, return JSON as text. `json()` is the explicit opt-in for the second case.
 */
export class ToolResult {
  readonly structured: unknown;
  readonly content: readonly ToolContentBlockV1[];

  constructor(params: {structured: unknown; content: readonly ToolContentBlockV1[]}) {
    this.structured = params.structured ?? null;
    this.content = params.content;
  }

  /** Joins the text blocks with newlines. */
  text(): string {
    return this.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n');
  }

  /** Parses `text()` as JSON, and throws when it is not JSON. */
  json<T = unknown>(): T {
    const text = this.text();
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new SyntaxError(`Tool result text is not JSON: ${preview(text)}`, {cause: error});
    }
  }
}

export interface DownloadedFile {
  /** Relative to the step working directory. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mediaType: string;
  readonly filename: string;
}

export function toDownloadedFile(file: DownloadedFileV1): DownloadedFile {
  return {
    path: file.path,
    bytes: file.bytes,
    sha256: file.sha256,
    mediaType: file.media_type,
    filename: file.filename,
  };
}

const PREVIEW_LENGTH = 80;

function preview(text: string): string {
  if (text === '') return '(empty)';
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
}
