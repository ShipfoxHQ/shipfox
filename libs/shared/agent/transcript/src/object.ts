import type {SessionViewRowMeta} from '@shipfox/api-logs-dto';
import {asLooseObject} from './entry-schema.js';

const SESSION_META_NUMBER_LOCALE = 'en-US';

export function field(value: unknown, key: string): unknown {
  const object = asLooseObject(value);
  return object?.[key];
}

export function stringField(value: unknown, key: string): string | undefined {
  const fieldValue = field(value, key);
  return typeof fieldValue === 'string' && fieldValue.length > 0 ? fieldValue : undefined;
}

export function numberField(value: unknown, key: string): number | undefined {
  const fieldValue = field(value, key);
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : undefined;
}

export function booleanField(value: unknown, key: string): boolean {
  return field(value, key) === true;
}

export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return toJson(value);
}

export function toJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return json === undefined ? String(value) : json;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(SESSION_META_NUMBER_LOCALE, {
    maximumFractionDigits: 1,
    notation: value >= 10000 ? 'compact' : 'standard',
  }).format(value);
}

export function formatCount(value: number, unit: string): string {
  return `${formatNumber(value)} ${unit}${value === 1 ? '' : 's'}`;
}

export function metaItem(
  label: string,
  value: string | null | undefined,
  inline = true,
): SessionViewRowMeta | null {
  if (value == null || value.length === 0) return null;
  return inline ? {label, value} : {label, value, inline};
}

export function isMeta(value: SessionViewRowMeta | null | undefined): value is SessionViewRowMeta {
  return value != null;
}
