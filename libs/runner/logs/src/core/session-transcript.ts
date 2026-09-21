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
  try {
    const parsed = JSON.parse(line) as unknown;
    return JSON.stringify(maskJsonValue(parsed, variants)) ?? '';
  } catch {
    return maskText(line, variants);
  }
}

function maskJsonValue(value: unknown, variants: string[]): unknown {
  if (typeof value === 'string') return maskText(value, variants);
  if (Array.isArray(value)) return value.map((item) => maskJsonValue(item, variants));
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      maskText(key, variants),
      maskJsonValue(nestedValue, variants),
    ]),
  );
}

function maskText(text: string, variants: string[]): string {
  return variants.length > 0 ? redactSecrets(text, variants) : text;
}
