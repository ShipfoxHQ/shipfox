/**
 * Pure state for interactive line wrapping: one global default plus the set of
 * lines that deliberately differ from it. Kept free of React so consumers can
 * drive it from their own reducer or persist it outside component state.
 * `useLogWrap` is the ergonomic React wrapper.
 */

export type LogLineId = string | number;

export interface WrapState {
  readonly globalWrap: boolean;
  /** Lines whose wrap deliberately differs from the global default. */
  readonly exceptions: ReadonlySet<LogLineId>;
}

export function createWrapState(globalWrap = false): WrapState {
  return {globalWrap, exceptions: new Set()};
}

/**
 * The `wrap` value to hand a `LogRow`: `undefined` lets the row inherit the
 * container default, while an overridden line resolves to the opposite of the
 * global value (expand one line when all are collapsed, or vice versa).
 */
export function resolveRowWrap(state: WrapState, id: LogLineId): boolean | undefined {
  return state.exceptions.has(id) ? !state.globalWrap : undefined;
}

export function toggleLineWrap(state: WrapState, id: LogLineId): WrapState {
  const exceptions = new Set(state.exceptions);
  if (exceptions.has(id)) exceptions.delete(id);
  else exceptions.add(id);
  return {...state, exceptions};
}

/**
 * Set the global default. A real change clears every per-line override so the
 * global control always wins; setting the current value is a no-op.
 */
export function setGlobalWrap(state: WrapState, globalWrap: boolean): WrapState {
  if (globalWrap === state.globalWrap) return state;
  return {globalWrap, exceptions: new Set()};
}

export function toggleGlobalWrap(state: WrapState): WrapState {
  return {globalWrap: !state.globalWrap, exceptions: new Set()};
}
