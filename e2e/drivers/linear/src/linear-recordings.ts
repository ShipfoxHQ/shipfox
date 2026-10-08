import {readdir, readFile} from 'node:fs/promises';

/** The raw `CallToolResult` of one call to the hosted Linear MCP. */
export interface LinearRecordedResult {
  content: ReadonlyArray<Record<string, unknown> & {type: string}>;
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
}

/**
 * One call to the hosted Linear MCP against the sandbox workspace, recorded once by hand with
 * `e2e/suites/eval/workflows/scripts/record-linear-responses.mjs`. The hosted MCP answers each of
 * these tools with one text block and no `structuredContent`, and the fake replays them as is.
 */
export interface LinearRecording {
  tool: string;
  arguments: Record<string, unknown>;
  result: LinearRecordedResult;
}

// Next to `src` and `dist`, so the fake finds the files whichever one it runs from.
const RECORDINGS_DIRECTORY = new URL('../recordings/', import.meta.url);

export async function loadLinearRecordings(): Promise<LinearRecording[]> {
  const files = (await readdir(RECORDINGS_DIRECTORY)).filter((file) => file.endsWith('.json'));
  return await Promise.all(
    files.sort().map(async (file) => {
      const text = await readFile(new URL(file, RECORDINGS_DIRECTORY), 'utf8');
      return JSON.parse(text) as LinearRecording;
    }),
  );
}

/** The same string for arguments that differ only in key order. */
export function linearArgumentsKey(arguments_: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(arguments_).sort(([a], [b]) => a.localeCompare(b)));
}
