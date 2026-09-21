import {redactSecrets} from '@shipfox/redact';
import {buildSecretVariants} from '#core/secrets.js';

const LINE_BREAK = /(\r\n|\n|\r)/;

/**
 * Masks decoded JSONL records while preserving their record boundaries. Invalid records are kept
 * as raw text because dropping one could prevent a later agent session from resuming.
 */
export function maskSessionTranscript(params: {jsonl: string; secrets: string[]}): string {
  const variants = buildSecretVariants(params.secrets);
  const parts = params.jsonl.split(LINE_BREAK);
  let maskedTranscript = '';

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? '';
    const hasLine = line.length > 0 || index < parts.length - 1;
    if (hasLine) maskedTranscript += maskJsonLine(line, variants);

    const lineEnding = parts[index + 1];
    if (lineEnding !== undefined) maskedTranscript += lineEnding;
  }

  return maskedTranscript;
}

function maskJsonLine(line: string, variants: string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return maskText(line, variants);
  }

  return JSON.stringify(maskJsonValue(parsed, variants)) ?? '';
}

type JsonContainer = unknown[] | Record<string, unknown>;
type PendingFrame = {source: JsonContainer; target: JsonContainer};

function maskJsonValue(value: unknown, variants: string[]): unknown {
  if (typeof value === 'string') return maskText(value, variants);
  if (!isJsonContainerValue(value)) return value;
  return maskJsonContainer(value, variants);
}

function isJsonContainerValue(value: unknown): value is JsonContainer {
  return value !== null && typeof value === 'object';
}

function maskJsonContainer(value: JsonContainer, variants: string[]): JsonContainer {
  const maskedRoot = createMaskedContainer(value);
  const pending: PendingFrame[] = [{source: value, target: maskedRoot}];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;

    if (Array.isArray(current.source)) {
      maskJsonArray(current.source, current.target as unknown[], variants, pending);
    } else {
      maskJsonObject(current.source, current.target as Record<string, unknown>, variants, pending);
    }
  }

  return maskedRoot;
}

function createMaskedContainer(value: JsonContainer): JsonContainer {
  return Array.isArray(value) ? [] : {};
}

function maskJsonArray(
  source: unknown[],
  target: unknown[],
  variants: string[],
  pending: PendingFrame[],
): void {
  for (let index = 0; index < source.length; index += 1) {
    const nestedValue = source[index];
    if (isJsonContainerValue(nestedValue)) {
      const maskedNestedValue = createMaskedContainer(nestedValue);
      target[index] = maskedNestedValue;
      pending.push({source: nestedValue, target: maskedNestedValue});
    } else {
      target[index] = maskJsonLeaf(nestedValue, variants);
    }
  }
}

function maskJsonObject(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  variants: string[],
  pending: PendingFrame[],
): void {
  for (const [key, nestedValue] of Object.entries(source)) {
    const maskedKey = maskText(key, variants);
    if (isJsonContainerValue(nestedValue)) {
      const maskedNestedValue = createMaskedContainer(nestedValue);
      assignMaskedProperty(target, maskedKey, maskedNestedValue);
      pending.push({source: nestedValue, target: maskedNestedValue});
    } else {
      assignMaskedProperty(target, maskedKey, maskJsonLeaf(nestedValue, variants));
    }
  }
}

function maskJsonLeaf(value: unknown, variants: string[]): unknown {
  return typeof value === 'string' ? maskText(value, variants) : value;
}

function assignMaskedProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function maskText(text: string, variants: string[]): string {
  return variants.length > 0 ? redactSecrets(text, variants) : text;
}
