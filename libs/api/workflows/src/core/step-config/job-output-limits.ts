import {
  WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES,
  WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH,
} from '@shipfox/workflow-document';
import {JobOutputNotJsonSafeError, type OutputOwner} from '#core/errors.js';

export const MAX_JOB_OUTPUT_ENTRIES = WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES;
export const MAX_JOB_OUTPUT_NESTING_DEPTH = WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH;
export const MAX_JOB_OUTPUTS_TOTAL_BYTES = 256 * 1024;
export const MAX_JOB_OUTPUT_VALUE_BYTES = 64 * 1024;

const textEncoder = new TextEncoder();

export type JsonSafeJobOutputValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonSafeJobOutputValue[]
  | {[key: string]: JsonSafeJobOutputValue};

interface OutputTarget {
  readonly key: string;
  readonly owner: OutputOwner;
}

export function normalizeJobOutputValue(
  value: unknown,
  outputKey: string,
  owner: OutputOwner = 'job',
): JsonSafeJobOutputValue {
  return normalize(value, {key: outputKey, owner}, new WeakSet<object>(), 0);
}

function notJsonSafe(target: OutputTarget, reason: string): JobOutputNotJsonSafeError {
  return new JobOutputNotJsonSafeError(target.key, reason, target.owner);
}

export function jobOutputValueByteLength(value: unknown): number {
  if (typeof value === 'string') return textEncoder.encode(value).byteLength;

  return jsonByteLength(value);
}

export function jobOutputRecordEntryByteLength(key: string, value: JsonSafeJobOutputValue): number {
  return textEncoder.encode(JSON.stringify(key)).byteLength + 1 + jsonByteLength(value);
}

function jsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return textEncoder.encode(serialized ?? '').byteLength;
}

function normalize(
  value: unknown,
  target: OutputTarget,
  ancestors: WeakSet<object>,
  depth: number,
): JsonSafeJobOutputValue {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw notJsonSafe(target, 'numbers must be finite');
      }
      return value;
    case 'bigint': {
      const numberValue = Number(value);
      return Number.isSafeInteger(numberValue) ? numberValue : value.toString();
    }
    case 'undefined':
      throw notJsonSafe(target, 'undefined is not a JSON value');
    case 'function':
    case 'symbol':
      throw notJsonSafe(target, `values of type ${typeof value} are not JSON values`);
    case 'object':
      return normalizeObject(value, target, ancestors, depth);
  }

  throw notJsonSafe(target, 'the value has an unsupported type');
}

function normalizeObject(
  value: object,
  target: OutputTarget,
  ancestors: WeakSet<object>,
  depth: number,
): JsonSafeJobOutputValue {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw notJsonSafe(target, 'dates must be valid');
    }
    return value.toISOString();
  }

  if (ancestors.has(value)) {
    throw notJsonSafe(target, 'the value contains a circular reference');
  }

  if (depth >= MAX_JOB_OUTPUT_NESTING_DEPTH) {
    throw notJsonSafe(
      target,
      `values cannot be nested deeper than ${MAX_JOB_OUTPUT_NESTING_DEPTH} levels`,
    );
  }

  if (Array.isArray(value)) {
    ancestors.add(value);
    try {
      const normalized: JsonSafeJobOutputValue[] = [];
      for (const item of value) {
        normalized.push(normalize(item, target, ancestors, depth + 1));
      }
      return normalized;
    } finally {
      ancestors.delete(value);
    }
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw notJsonSafe(target, 'the value has an unsupported object type');
  }

  ancestors.add(value);
  try {
    return Object.fromEntries(
      Object.keys(value).map((key) => [
        key,
        normalize((value as Record<string, unknown>)[key], target, ancestors, depth + 1),
      ]),
    ) as {[key: string]: JsonSafeJobOutputValue};
  } finally {
    ancestors.delete(value);
  }
}
