import type {ContractRead, ContractScalar, ContractShape} from './contract-schema.js';

type Segment = {field: string} | {index: number};
type ShapeType = 'string' | 'number' | 'boolean' | 'list' | 'object';

const ABSENT = Symbol('absent');

/**
 * The checks of `expect` that a result fails, one message each, the same checks the gate of a
 * generated step makes. A path that leads nowhere fails its check, and so does a value of
 * another type, so `"1"` never equals `1`.
 */
export function failedChecks({
  expect,
  result,
  valuesOnly = false,
}: {
  expect: ContractRead['expect'];
  result: unknown;
  /** A tool whose catalog output schema is closed checks values and nothing else. */
  valuesOnly?: boolean;
}): string[] {
  return [
    ...(valuesOnly ? [] : shapeFailures({shape: expect.shape, result})),
    ...valueFailures({values: expect.values, result}),
    ...listFailures({lists: expect.includes, result, held: true}),
    ...listFailures({lists: expect.excludes, result, held: false}),
    ...patternFailures({expect, result}),
  ];
}

function shapeFailures({
  shape,
  result,
}: {
  shape: ContractShape | undefined;
  result: unknown;
}): string[] {
  if (shape === undefined) return [];
  return shapeLeaves(shape).flatMap(({segments, type}) => {
    const value = read(result, segments);
    return hasType(value, type)
      ? []
      : [`shape: ${describePath(segments)} is ${describe(value)}, not ${type}`];
  });
}

/**
 * A text value that is absent reads as `""`, as in the generated gate, so `items[0].id: ''` holds
 * for an empty list.
 */
function valueFailures({
  values = {},
  result,
}: {
  values: Record<string, ContractScalar> | undefined;
  result: unknown;
}): string[] {
  return Object.entries(values).flatMap(([path, expected]) => {
    const value = read(result, parsePath(path));
    const actual = value === ABSENT && typeof expected === 'string' ? '' : value;
    return equals(actual, expected)
      ? []
      : [`values: ${path} is ${describe(value)}, not ${JSON.stringify(expected)}`];
  });
}

/** `includes` wants an item of the list with the values, and `excludes` wants none. */
function listFailures({
  lists = {},
  result,
  held,
}: {
  lists: Record<string, Record<string, ContractScalar>> | undefined;
  result: unknown;
  held: boolean;
}): string[] {
  const name = held ? 'includes' : 'excludes';
  return Object.entries(lists).flatMap(([path, item]) => {
    const list = read(result, parsePath(path));
    if (!Array.isArray(list)) return [`${name}: ${path} is ${describe(list)}, not a list`];
    const found = list.some((candidate) => holds(candidate, item));
    if (found === held) return [];
    return [
      held
        ? `includes: no item of ${path} holds ${JSON.stringify(item)}`
        : `excludes: an item of ${path} holds ${JSON.stringify(item)}`,
    ];
  });
}

/** `matches` wants a text value at a path, and `text` a result that is itself text. */
function patternFailures({
  expect,
  result,
}: {
  expect: ContractRead['expect'];
  result: unknown;
}): string[] {
  const matches = Object.entries(expect.matches ?? {}).flatMap(([path, pattern]) => {
    const value = read(result, parsePath(path));
    return typeof value === 'string' && new RegExp(pattern, 'u').test(value)
      ? []
      : [`matches: ${path} is ${describe(value)}, which does not match /${pattern}/`];
  });
  const text = (expect.text ?? []).flatMap((pattern) =>
    typeof result === 'string' && new RegExp(pattern, 'u').test(result)
      ? []
      : [`text: the result does not match /${pattern}/`],
  );
  return [...matches, ...text];
}

/**
 * The value at a dotted path such as `messages[0].text`, read the way a `$steps` reference reads
 * it. Undefined when the path leads nowhere.
 */
export function valueAt(value: unknown, path: string): unknown {
  const found = read(value, parsePath(path));
  return found === ABSENT ? undefined : found;
}

function holds(candidate: unknown, item: Record<string, ContractScalar>): boolean {
  return Object.entries(item).every(([path, expected]) =>
    equals(read(candidate, parsePath(path)), expected),
  );
}

function equals(value: unknown, expected: ContractScalar): boolean {
  return typeof value === typeof expected && value === expected;
}

function read(value: unknown, segments: Segment[]): unknown {
  let current = value;
  for (const segment of segments) {
    if ('field' in segment) {
      if (!isMap(current) || !Object.hasOwn(current, segment.field)) return ABSENT;
      current = current[segment.field];
    } else {
      if (!Array.isArray(current) || current.length <= segment.index) return ABSENT;
      current = current[segment.index];
    }
  }
  return current;
}

function hasType(value: unknown, type: ShapeType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value);
    case 'object':
      return isMap(value);
  }
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flattens a shape to the typed leaves it names. `[{...}]` reads the first item of a list. */
function shapeLeaves(
  shape: ContractShape,
  prefix: Segment[] = [],
): Array<{segments: Segment[]; type: ShapeType}> {
  if (typeof shape === 'string') return [{segments: prefix, type: shape}];
  if (Array.isArray(shape)) return shapeLeaves(shape[0], [...prefix, {index: 0}]);
  return Object.entries(shape).flatMap(([field, child]) =>
    shapeLeaves(child, [...prefix, {field}]),
  );
}

function parsePath(path: string): Segment[] {
  return [...path.matchAll(/([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/gu)].map(([, field, index]) =>
    field === undefined ? {index: Number(index)} : {field},
  );
}

function describePath(segments: Segment[]): string {
  if (segments.length === 0) return 'the result';
  return segments
    .map((segment, position) => {
      if ('index' in segment) return `[${segment.index}]`;
      return position === 0 ? segment.field : `.${segment.field}`;
    })
    .join('');
}

function describe(value: unknown): string {
  if (value === ABSENT) return 'absent';
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}
