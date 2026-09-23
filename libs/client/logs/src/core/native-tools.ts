import type {ActionPresentation, PairedAction} from './activity.js';

type NativeFamily =
  | 'read'
  | 'edit'
  | 'write'
  | 'shell'
  | 'search'
  | 'list'
  | 'web-search'
  | 'web-fetch';

const nativeTools: Readonly<Record<string, NativeFamily>> = {
  read: 'read',
  read_file: 'read',
  Read: 'read',
  edit: 'edit',
  edit_file: 'edit',
  Edit: 'edit',
  MultiEdit: 'edit',
  write: 'write',
  write_file: 'write',
  Write: 'write',
  bash: 'shell',
  Bash: 'shell',
  grep: 'search',
  Grep: 'search',
  glob: 'search',
  Glob: 'search',
  find: 'search',
  ls: 'list',
  LS: 'list',
  list_files: 'list',
  web_search: 'web-search',
  WebSearch: 'web-search',
  fetch_content: 'web-fetch',
  WebFetch: 'web-fetch',
  get_search_content: 'web-fetch',
};

const labels: Record<NativeFamily, string> = {
  read: 'Read File',
  edit: 'Edit File',
  write: 'Write File',
  shell: 'Run Command',
  search: 'Search Files',
  list: 'List Files',
  'web-search': 'Search Web',
  'web-fetch': 'Fetch Page',
};

const iconKinds: Record<NativeFamily, ActionPresentation['iconKind']> = {
  read: 'file',
  edit: 'edit',
  write: 'write',
  shell: 'shell',
  search: 'search',
  list: 'list',
  'web-search': 'web',
  'web-fetch': 'web',
};

const EXIT_CODE_PREFIX = /^Exit code: (-?\d+)\n(?:Output:\s*\n?)?/i;

/** Returns no presentation when a native name or its recorded input cannot be interpreted. */
export function nativeActionPresentation(action: PairedAction): ActionPresentation | undefined {
  const request = action.request;
  if (!request) return undefined;
  return nativePresentationFromPayload(request.name, request.input, action.result?.output);
}

function nativePresentationFromPayload(
  name: string,
  inputText: string,
  output?: string,
): ActionPresentation | undefined {
  const family = nativeTools[name];
  if (!family) return undefined;
  const input = parseObject(inputText);
  if (!input) return undefined;
  const target = nativeTarget(family, input);
  if (!target) return undefined;

  const shell = family === 'shell' && output !== undefined ? parseShellOutput(output) : null;

  return {
    label: labels[family],
    target,
    iconKind: iconKinds[family],
    detailKind: 'code',
    readClassification: nativeReadClassification(family),
    statusDetail: nativeStatusDetail(family, output, shell),
    detail: nativeDetail(family, input, target, output, shell),
  };
}

function nativeReadClassification(family: NativeFamily): ActionPresentation['readClassification'] {
  if (family === 'edit' || family === 'write') return 'write';
  if (family === 'shell') return 'unknown';
  return 'read';
}

function nativeStatusDetail(
  family: NativeFamily,
  output: string | undefined,
  shell: ReturnType<typeof parseShellOutput> | null,
): string | undefined {
  if (shell?.exitCode !== null && shell?.exitCode !== undefined) return `exit ${shell.exitCode}`;
  if (output === undefined || (family !== 'search' && family !== 'list')) return undefined;
  const count = resultCount(output, family);
  if (count === null) return undefined;
  if (family === 'search') return `${count} ${count === 1 ? 'match' : 'matches'}`;
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

function nativeDetail(
  family: NativeFamily,
  input: Record<string, unknown>,
  target: string,
  output: string | undefined,
  shell: ReturnType<typeof parseShellOutput> | null,
): NonNullable<ActionPresentation['detail']> | null {
  if (family === 'edit' || family === 'write') {
    return {label: 'File', value: filePath(input) ?? target, kind: 'code'};
  }
  if (output === undefined) return null;
  return {
    label: family === 'shell' ? 'Output' : 'Result',
    value: shell?.text ?? output,
    kind: 'code',
  };
}

export function nativeShellExitCode(name: string, output: string): number | null {
  if (nativeTools[name] !== 'shell') return null;
  return parseShellOutput(output).exitCode;
}

function nativeTarget(family: NativeFamily, input: Record<string, unknown>): string | null {
  if (family === 'shell') return stringField(input, 'command') ?? stringField(input, 'cmd');
  if (family === 'search') return stringField(input, 'pattern') ?? stringField(input, 'query');
  if (family === 'web-search' || family === 'web-fetch') return webTarget(family, input);
  const path =
    family === 'list' ? (stringField(input, 'directory') ?? filePath(input)) : filePath(input);
  if (!path) return null;
  if (family !== 'read') return path;
  const offset = positiveInteger(input.offset);
  const limit = positiveInteger(input.limit);
  if (offset !== null && limit !== null) return `${path} (lines ${offset}–${offset + limit - 1})`;
  if (offset !== null) return `${path} (from line ${offset})`;
  if (limit !== null) return `${path} (first ${limit} lines)`;
  return path;
}

function webTarget(
  family: 'web-search' | 'web-fetch',
  input: Record<string, unknown>,
): string | null {
  if (family === 'web-search') return stringField(input, 'query') ?? firstString(input, 'queries');
  return (
    stringField(input, 'url') ??
    firstString(input, 'urls') ??
    stringField(input, 'query') ??
    stringField(input, 'responseId')
  );
}

function filePath(input: Record<string, unknown>): string | null {
  return stringField(input, 'file_path') ?? stringField(input, 'path');
}

function firstString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (!Array.isArray(value)) return null;
  const first = value.find((item) => typeof item === 'string' && item.trim());
  return typeof first === 'string' ? first.trim() : null;
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function textField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseShellOutput(output: string): {text: string; exitCode: number | null} {
  const object = parseObject(output);
  if (object) {
    const exitCode = integerField(object, 'exitCode') ?? integerField(object, 'exit_code');
    const stdout = textField(object, 'stdout');
    const stderr = textField(object, 'stderr');
    if (exitCode !== null || stdout !== null || stderr !== null) {
      return {text: [stdout, stderr].filter((value) => value !== null).join('\n'), exitCode};
    }
  }
  const match = EXIT_CODE_PREFIX.exec(output);
  if (!match) return {text: output, exitCode: null};
  const exitCode = Number(match[1]);
  if (!Number.isSafeInteger(exitCode)) return {text: output, exitCode: null};
  return {text: output.slice(match[0].length), exitCode};
}

function integerField(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function resultCount(output: string, family: 'search' | 'list'): number | null {
  const object = parseObject(output);
  if (!object) return null;
  const explicit = integerField(object, 'count') ?? integerField(object, 'total');
  if (explicit !== null && explicit >= 0) return explicit;
  const items = family === 'search' ? object.matches : object.files;
  return Array.isArray(items) ? items.length : null;
}
