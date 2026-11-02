// No imports: the workflow bundle reads this file, and it can't carry pi or any I/O.

/** Why a turn ended in `failed`. These are the only values `failure_code` takes. */
export const TURN_FAILURE_CODES = [
  'step_limit',
  'provider_error',
  'provider_unavailable',
  'context_overflow',
  'model_unavailable',
  'credentials_unavailable',
  'session_unreadable',
  'tool_catalog_unavailable',
  'timeout',
  'internal_error',
] as const;

export type TurnFailureCode = (typeof TURN_FAILURE_CODES)[number];

export function isTurnFailureCode(value: unknown): value is TurnFailureCode {
  return TURN_FAILURE_CODES.includes(value as TurnFailureCode);
}
