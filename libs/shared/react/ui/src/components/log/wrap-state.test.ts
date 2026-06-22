import {
  createWrapState,
  resolveRowWrap,
  setGlobalWrap,
  toggleGlobalWrap,
  toggleLineWrap,
} from './wrap-state.js';

describe('wrap-state', () => {
  test('a fresh state carries the given global default and no overrides', () => {
    const state = createWrapState(true);

    expect(state.globalWrap).toBe(true);
    expect(state.exceptions.size).toBe(0);
  });

  test('a row with no override inherits the global default', () => {
    const state = createWrapState(false);

    expect(resolveRowWrap(state, 'a')).toBeUndefined();
  });

  test('an overridden row resolves to the opposite of the global default', () => {
    const state = toggleLineWrap(createWrapState(false), 'a');

    expect(resolveRowWrap(state, 'a')).toBe(true);
  });

  test('toggling an overridden row again clears its override', () => {
    const cleared = toggleLineWrap(toggleLineWrap(createWrapState(false), 'a'), 'a');

    expect(cleared.exceptions.has('a')).toBe(false);
    expect(resolveRowWrap(cleared, 'a')).toBeUndefined();
  });

  test('toggling the global default clears every override', () => {
    const overridden = toggleLineWrap(toggleLineWrap(createWrapState(false), 'a'), 'b');

    const toggled = toggleGlobalWrap(overridden);

    expect(toggled.globalWrap).toBe(true);
    expect(toggled.exceptions.size).toBe(0);
  });

  test('setting a changed global value clears overrides', () => {
    const overridden = toggleLineWrap(createWrapState(false), 'a');

    const result = setGlobalWrap(overridden, true);

    expect(result.globalWrap).toBe(true);
    expect(result.exceptions.size).toBe(0);
  });

  test('setting the current global value is a no-op that keeps overrides', () => {
    const overridden = toggleLineWrap(createWrapState(false), 'a');

    const result = setGlobalWrap(overridden, false);

    expect(result).toBe(overridden);
  });

  test('transitions do not mutate the previous state', () => {
    const state = createWrapState(false);

    toggleLineWrap(state, 'a');

    expect(state.exceptions.size).toBe(0);
  });
});
