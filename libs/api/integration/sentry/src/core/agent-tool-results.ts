import {IntegrationProviderError} from '@shipfox/api-integration-spi';

const MAX_RESULT_BYTES = 64 * 1024;
const MAX_FRAMES_PER_EXCEPTION = 50;
const encoder = new TextEncoder();

type JsonObject = Record<string, unknown>;

export interface SentryToolResult {
  data: JsonObject | JsonObject[];
  nextCursor: string | null;
  truncated: boolean;
  sourceUrl: string;
}

function record(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function copy(target: JsonObject, source: JsonObject, keys: readonly string[]): void {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      target[key] = value;
    }
  }
}

export function projectSentryProject(raw: JsonObject): JsonObject {
  const project: JsonObject = {};
  copy(project, raw, ['id', 'slug', 'name', 'platform']);
  return project;
}

export function projectSentryIssue(raw: JsonObject): JsonObject {
  const issue: JsonObject = {};
  copy(issue, raw, [
    'id',
    'shortId',
    'title',
    'status',
    'substatus',
    'level',
    'culprit',
    'firstSeen',
    'lastSeen',
    'permalink',
  ]);
  const project = record(raw.project);
  if (project) issue.project = projectSentryProject(project);
  for (const scope of ['lifetime', 'filtered'] as const) {
    const counts = record(raw[scope]);
    if (!counts) continue;
    const projected: JsonObject = {};
    copy(projected, counts, ['count', 'userCount', 'firstSeen', 'lastSeen']);
    if (Object.keys(projected).length > 0) issue[scope] = projected;
  }
  return issue;
}

export function projectSentryEvent(raw: JsonObject): {data: JsonObject; truncated: boolean} {
  const event: JsonObject = {};
  copy(event, raw, ['id', 'platform', 'environment']);
  copyRenamed(event, 'issueId', raw.groupID);
  copyRenamed(event, 'timestamp', raw.dateCreated);
  const release = record(raw.release);
  if (release) copyRenamed(event, 'release', release.version);

  const projected = projectExceptions(raw.entries);
  if (projected.exceptions.length > 0) event.exceptions = projected.exceptions;
  return {data: event, truncated: projected.truncated};
}

function projectExceptions(entriesValue: unknown): {exceptions: JsonObject[]; truncated: boolean} {
  let truncated = false;
  const exceptions: JsonObject[] = [];
  const entries = Array.isArray(entriesValue) ? entriesValue : [];
  for (const entryValue of entries) {
    const entry = record(entryValue);
    if (entry?.type !== 'exception') continue;
    const values = record(entry.data)?.values;
    if (!Array.isArray(values)) continue;
    for (const exceptionValue of values) {
      const exception = record(exceptionValue);
      if (!exception) continue;
      const projected = projectException(exception);
      truncated ||= projected.truncated;
      exceptions.push(projected.data);
    }
  }
  return {exceptions, truncated};
}

function projectException(exception: JsonObject): {data: JsonObject; truncated: boolean} {
  const data: JsonObject = {};
  copy(data, exception, ['type', 'value']);
  const mechanism = record(exception.mechanism);
  if (mechanism) copyRenamed(data, 'mechanism', mechanism.type);
  const frames = projectFrames(record(exception.stacktrace)?.frames);
  if (frames) data.frames = frames.data;
  return {data, truncated: frames?.truncated ?? false};
}

function projectFrames(rawFrames: unknown): {data: JsonObject[]; truncated: boolean} | undefined {
  if (!Array.isArray(rawFrames)) return undefined;
  const indexed = rawFrames
    .map((value, index) => ({value: record(value), index}))
    .filter((frame): frame is {value: JsonObject; index: number} => frame.value !== undefined);
  const inApp = indexed.filter((frame) => frame.value.inApp === true);
  const other = indexed.filter((frame) => frame.value.inApp !== true);
  const selected = [...inApp, ...other]
    .slice(0, MAX_FRAMES_PER_EXCEPTION)
    .sort((a, b) => a.index - b.index);
  return {
    data: selected.map(({value}) => projectFrame(value)),
    truncated: rawFrames.length > selected.length,
  };
}

function copyRenamed(target: JsonObject, key: string, value: unknown): void {
  if (typeof value === 'string' || typeof value === 'number') target[key] = value;
}

function projectFrame(raw: JsonObject): JsonObject {
  const frame: JsonObject = {};
  for (const [source, destination] of [
    ['function', 'function'],
    ['module', 'module'],
    ['filename', 'file'],
    ['lineNo', 'line'],
    ['colNo', 'column'],
    ['inApp', 'inApp'],
    ['contextLine', 'contextLine'],
  ] as const) {
    const value = raw[source];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      frame[destination] = value;
    }
  }
  for (const key of ['preContext', 'postContext'] as const) {
    const value = raw[key];
    if (Array.isArray(value))
      frame[key] = value.filter((line): line is string => typeof line === 'string');
  }
  if (Array.isArray(raw.context)) {
    frame.sourceContext = raw.context
      .filter(
        (line): line is [number, string] =>
          Array.isArray(line) &&
          line.length === 2 &&
          typeof line[0] === 'number' &&
          typeof line[1] === 'string',
      )
      .map(([line, text]) => ({line, text}));
  }
  return frame;
}

export function boundedSentryToolResult(result: SentryToolResult): {
  content: {type: 'text'; text: string}[];
  structuredContent: SentryToolResult;
} {
  const output = structuredClone(result);
  if (toolResultBytes(output) > MAX_RESULT_BYTES) {
    output.truncated = true;
    removeSourceContext(output.data);
    removeFramesUntilFit(output);
    removeListItemsUntilFit(output);
    shortenTextUntilFit(output);
  }
  if (toolResultBytes(output) > MAX_RESULT_BYTES) {
    output.data = minimalData(output.data);
    output.truncated = true;
  }
  if (toolResultBytes(output) > MAX_RESULT_BYTES) {
    throw new IntegrationProviderError('content-too-large', 'Sentry result is too large');
  }
  return {content: [{type: 'text', text: JSON.stringify(output)}], structuredContent: output};
}

function toolResultBytes(result: SentryToolResult): number {
  return encoder.encode(
    JSON.stringify({
      content: [{type: 'text', text: JSON.stringify(result)}],
      structuredContent: result,
    }),
  ).length;
}

function removeSourceContext(data: SentryToolResult['data']): void {
  const event = record(data);
  if (!event || !Array.isArray(event.exceptions)) return;
  for (const exceptionValue of event.exceptions) {
    const exception = record(exceptionValue);
    if (!exception || !Array.isArray(exception.frames)) continue;
    for (const frameValue of exception.frames) {
      const frame = record(frameValue);
      if (!frame) continue;
      delete frame.preContext;
      delete frame.contextLine;
      delete frame.postContext;
      delete frame.sourceContext;
    }
  }
}

function removeFramesUntilFit(result: SentryToolResult): void {
  const event = record(result.data);
  if (!event || !Array.isArray(event.exceptions)) return;
  while (toolResultBytes(result) > MAX_RESULT_BYTES) {
    const exception = [...event.exceptions]
      .reverse()
      .map(record)
      .find((value) => value && Array.isArray(value.frames) && value.frames.length > 0);
    if (!exception || !Array.isArray(exception.frames)) return;
    const reverseIndex = [...exception.frames]
      .reverse()
      .findIndex((frame) => record(frame)?.inApp !== true);
    const nonAppIndex = reverseIndex < 0 ? -1 : exception.frames.length - 1 - reverseIndex;
    exception.frames.splice(nonAppIndex < 0 ? exception.frames.length - 1 : nonAppIndex, 1);
  }
}

function removeListItemsUntilFit(result: SentryToolResult): void {
  if (!Array.isArray(result.data)) return;
  while (result.data.length > 1 && toolResultBytes(result) > MAX_RESULT_BYTES) result.data.pop();
}

function shortenTextUntilFit(result: SentryToolResult): void {
  while (toolResultBytes(result) > MAX_RESULT_BYTES) {
    const strings = mutableStrings(result.data);
    const longest = strings.sort((a, b) => b.value.length - a.value.length)[0];
    if (!longest) return;
    longest.parent[longest.key] = longest.value.slice(0, Math.floor(longest.value.length / 2));
  }
}

function mutableStrings(value: unknown): {parent: JsonObject; key: string; value: string}[] {
  const result: {parent: JsonObject; key: string; value: string}[] = [];
  if (Array.isArray(value)) {
    for (const item of value) result.push(...mutableStrings(item));
    return result;
  }
  const object = record(value);
  if (!object) return result;
  for (const [key, child] of Object.entries(object)) {
    if (typeof child === 'string') {
      if (!['id', 'issueId', 'shortId', 'permalink'].includes(key) && child.length > 0) {
        result.push({parent: object, key, value: child});
      }
    } else result.push(...mutableStrings(child));
  }
  return result;
}

function minimalData(data: SentryToolResult['data']): SentryToolResult['data'] {
  if (Array.isArray(data)) return data.length === 0 ? [] : [{id: data[0]?.id}];
  const minimal: JsonObject = {};
  copy(minimal, data, ['id', 'issueId', 'permalink']);
  return minimal;
}
