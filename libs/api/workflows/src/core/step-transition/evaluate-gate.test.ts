import {evaluateGate, gateResultPayload, readStepGate} from './evaluate-gate.js';

function gateConfig(source: string, restartFrom?: string): Record<string, unknown> {
  return {
    run: 'echo hi',
    gate: {
      success_if: {language: 'cel', check: 'syntax', source},
      ...(restartFrom ? {on_failure: {restart_from: restartFrom}} : {}),
    },
  };
}

describe('readStepGate', () => {
  test('returns undefined when the config has no gate', () => {
    expect(readStepGate({run: 'echo hi'})).toBeUndefined();
  });

  test('parses success_if and on_failure', () => {
    const gate = readStepGate(gateConfig('exit_code == 0', 'producer'));
    expect(gate?.successIf?.source).toBe('exit_code == 0');
    expect(gate?.onFailure).toEqual({restartFrom: 'producer'});
  });
});

describe('evaluateGate', () => {
  test('no gate → no-gate', () => {
    expect(
      evaluateGate(readStepGate({run: 'echo hi'}), {status: 'succeeded', exitCode: 0}),
    ).toEqual({
      kind: 'no-gate',
    });
  });

  test('exit_code == 0 passes for exit 0', () => {
    const gate = readStepGate(gateConfig('exit_code == 0'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toEqual({
      kind: 'passed',
      source: 'exit_code == 0',
    });
  });

  test('exit_code == 0 fails for a non-zero exit', () => {
    const gate = readStepGate(gateConfig('exit_code == 0'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: 1})).toEqual({
      kind: 'failed',
      source: 'exit_code == 0',
    });
  });

  test('a passing gate can succeed a non-zero exit (success_if: exit_code == 1)', () => {
    const gate = readStepGate(gateConfig('exit_code == 1'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: 1})).toMatchObject({kind: 'passed'});
  });

  test('a missing exit code is uncheckable (never evaluated)', () => {
    const gate = readStepGate(gateConfig('exit_code == 0'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: null})).toMatchObject({
      kind: 'uncheckable',
    });
  });

  test('an evaluation error is uncheckable, not a gate failure', () => {
    const gate = readStepGate(gateConfig('missing_var == 0'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toMatchObject({
      kind: 'uncheckable',
    });
  });
});

describe('gateResultPayload', () => {
  test('no-gate → null', () => {
    expect(gateResultPayload({kind: 'no-gate'}, 0)).toBeNull();
  });

  test('passed records the source and evaluated exit code', () => {
    expect(gateResultPayload({kind: 'passed', source: 'exit_code == 0'}, 0)).toEqual({
      passed: true,
      source: 'exit_code == 0',
      exit_code: 0,
    });
  });

  test('failed records the source and evaluated exit code', () => {
    expect(gateResultPayload({kind: 'failed', source: 'exit_code == 0'}, 1)).toEqual({
      passed: false,
      source: 'exit_code == 0',
      exit_code: 1,
    });
  });

  test('uncheckable records the reason and a null exit code', () => {
    expect(gateResultPayload({kind: 'uncheckable', reason: 'no exit code'}, null)).toEqual({
      passed: false,
      uncheckable: true,
      reason: 'no exit code',
      exit_code: null,
    });
  });
});
