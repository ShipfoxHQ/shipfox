import {parseWorkflowTemplate, planInterpolationField} from '@shipfox/expression';
import {
  evaluateGate,
  evaluateGateFeedback,
  gateResultPayload,
  readStepGate,
  selectRestartRule,
} from './evaluate-gate.js';

function gateConfig(
  source: string,
  restartFrom?: string,
  maxAttempts?: unknown,
): Record<string, unknown> {
  return {
    run: 'echo hi',
    gate: {
      success: {language: 'cel', check: 'syntax', source},
      ...(restartFrom
        ? {
            on_failure: {
              restart_from: restartFrom,
              ...(maxAttempts === undefined ? {} : {max_attempts: maxAttempts}),
            },
          }
        : {}),
    },
  };
}

function feedbackTemplate(source: string) {
  const plan = planInterpolationField({
    field: 'step.feedback',
    segments: parseWorkflowTemplate(source),
  });
  if (!plan.ok) throw new Error('Expected test feedback template to plan');
  return plan.plan.field;
}

function gateTrace(source: string, value: boolean) {
  return [
    {
      expression: source,
      roots: ['step'],
      fillTarget: 'step-report',
      evaluatedAt: 'step-report',
      value: String(value),
      field: 'step.success',
    },
  ];
}

function degradedGateTrace(source: string, roots: readonly string[]) {
  return [
    {
      expression: source,
      roots,
      fillTarget: 'step-report' as const,
      evaluatedAt: 'step-report' as const,
      value: 'false',
      degraded: true,
      field: 'step.success' as const,
    },
  ];
}

describe('readStepGate', () => {
  test('returns undefined when the config has no gate', () => {
    expect(readStepGate({run: 'echo hi'})).toBeUndefined();
  });

  test('parses success and on_failure', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0', 'producer'));
    expect(gate?.success?.source).toBe('step.exit_code == 0');
    expect(gate?.onFailure).toEqual([{restartFrom: 'producer'}]);
  });

  test.each([1, 11, 1_000])('parses max_attempts: %s', (maxAttempts) => {
    const gate = readStepGate(gateConfig('step.exit_code == 0', 'producer', maxAttempts));

    expect(gate?.onFailure).toMatchObject([{restartFrom: 'producer', maxAttempts}]);
  });

  test.each([
    0,
    1.5,
    -1,
    '3',
    true,
    null,
    1_001,
  ])('rejects malformed max_attempts: %s without a restart policy', (maxAttempts) => {
    const gate = readStepGate(gateConfig('step.exit_code == 0', 'producer', maxAttempts));

    expect(gate?.success?.source).toBe('step.exit_code == 0');
    expect(gate?.onFailure).toBeUndefined();
  });

  test('leaves a missing max_attempts for the legacy transition default', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0', 'producer'));

    expect(gate?.onFailure).toEqual([{restartFrom: 'producer'}]);
  });

  test('parses feedback templates from on_failure', () => {
    const gate = readStepGate({
      ...gateConfig('step.exit_code == 0'),
      gate: {
        success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
        on_failure: {
          restart_from: 'producer',
          feedback: 'failed',
          feedback_template: feedbackTemplate(`failed: \${{ step.outputs.summary }}`),
        },
      },
    });

    expect(gate?.onFailure?.[0]?.feedbackTemplate).toEqual(
      feedbackTemplate(`failed: \${{ step.outputs.summary }}`),
    );
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

  test('step.exit_code == 0 passes for exit 0', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toEqual({
      kind: 'passed',
      source: 'step.exit_code == 0',
      trace: gateTrace('step.exit_code == 0', true),
    });
  });

  test('step.exit_code == 0 fails for a non-zero exit', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: 1})).toEqual({
      kind: 'failed',
      source: 'step.exit_code == 0',
      trace: gateTrace('step.exit_code == 0', false),
    });
  });

  test('a passing gate can succeed a non-zero exit (success: step.exit_code == 1)', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 1'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: 1})).toMatchObject({kind: 'passed'});
  });

  test('exit_code arithmetic can pass using CEL int values at runtime', () => {
    const gate = readStepGate(gateConfig('step.exit_code % 2 == 0'));

    const result = evaluateGate(gate, {status: 'succeeded', exitCode: 2});

    expect(result).toEqual({
      kind: 'passed',
      source: 'step.exit_code % 2 == 0',
      trace: gateTrace('step.exit_code % 2 == 0', true),
    });
  });

  test('exit_code arithmetic can fail using CEL int values at runtime', () => {
    const gate = readStepGate(gateConfig('step.exit_code % 2 == 0'));

    const result = evaluateGate(gate, {status: 'failed', exitCode: 3});

    expect(result).toEqual({
      kind: 'failed',
      source: 'step.exit_code % 2 == 0',
      trace: gateTrace('step.exit_code % 2 == 0', false),
    });
  });

  test('step.status gates on the reported step status', () => {
    const gate = readStepGate(gateConfig('step.status == "succeeded"'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toMatchObject({kind: 'passed'});
    expect(evaluateGate(gate, {status: 'failed', exitCode: 0})).toMatchObject({kind: 'failed'});
  });

  test('resolves vars from the run-creation snapshot', () => {
    const gate = readStepGate(gateConfig('vars.ENABLED == "true"'));

    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0}, {ENABLED: 'true'})).toMatchObject(
      {kind: 'passed'},
    );
  });

  test('step.outputs gates on reported output values', () => {
    const gate = readStepGate(gateConfig('step.outputs.pass == true'));

    const passed = evaluateGate(gate, {
      status: 'succeeded',
      exitCode: 0,
      output: {pass: true},
    });
    const failed = evaluateGate(gate, {
      status: 'succeeded',
      exitCode: 0,
      output: {pass: false},
    });

    expect(passed).toEqual({
      kind: 'passed',
      source: 'step.outputs.pass == true',
      trace: gateTrace('step.outputs.pass == true', true),
    });
    expect(failed).toEqual({
      kind: 'failed',
      source: 'step.outputs.pass == true',
      trace: gateTrace('step.outputs.pass == true', false),
    });
  });

  test('tool-step output gates do not require an exit code', () => {
    const source = 'step.outputs.result.number == 1';
    const gate = readStepGate(gateConfig(source));

    expect(
      evaluateGate(
        gate,
        {status: 'succeeded', exitCode: null, output: {result: {number: 1}}},
        undefined,
        {stepType: 'tool'},
      ),
    ).toEqual({
      kind: 'passed',
      source,
      trace: gateTrace(source, true),
    });
  });

  test('a failing tool-step output gate remains checkable without an exit code', () => {
    const source = 'step.outputs.result.number == 1';
    const gate = readStepGate(gateConfig(source));

    expect(
      evaluateGate(
        gate,
        {status: 'succeeded', exitCode: null, output: {result: {number: 2}}},
        undefined,
        {stepType: 'tool'},
      ),
    ).toEqual({
      kind: 'failed',
      source,
      trace: gateTrace(source, false),
    });
  });

  describe('tool-step step.error', () => {
    const source = 'step.status == "failed" && step.error.code == "not-found"';
    const evaluateToolFailure = (error: Record<string, unknown>) =>
      evaluateGate(
        readStepGate(gateConfig(source)),
        {status: 'failed', exitCode: null, error, output: null},
        undefined,
        {stepType: 'tool'},
      );

    test('passes a step whose tool call failed with the expected code', () => {
      expect(
        evaluateToolFailure({code: 'not-found', message: 'missing', reason: 'tool_error'}).kind,
      ).toBe('passed');
    });

    test('fails a step whose tool call failed with another code', () => {
      expect(evaluateToolFailure({code: 'provider-unavailable', message: 'down'}).kind).toBe(
        'failed',
      );
    });

    test('exposes the provider status as an integer', () => {
      const statusSource = 'has(step.error.status) && step.error.status == 404';

      expect(
        evaluateGate(
          readStepGate(gateConfig(statusSource)),
          {status: 'failed', exitCode: null, error: {code: 'not-found', status: 404}},
          undefined,
          {stepType: 'tool'},
        ).kind,
      ).toBe('passed');
      expect(
        evaluateGate(
          readStepGate(gateConfig(statusSource)),
          {status: 'failed', exitCode: null, error: {code: 'not-found'}},
          undefined,
          {stepType: 'tool'},
        ).kind,
      ).toBe('failed');
    });

    test('is null when the tool call succeeded', () => {
      const nullSource = 'step.error == null';

      expect(
        evaluateGate(
          readStepGate(gateConfig(nullSource)),
          {status: 'succeeded', exitCode: null, output: {}},
          undefined,
          {stepType: 'tool'},
        ).kind,
      ).toBe('passed');
    });
  });

  test('a non-boolean gate result is an evaluation error, not a failed gate', () => {
    const source = 'step.outputs.ready';
    const gate = readStepGate(gateConfig(source));

    const result = evaluateGate(gate, {
      status: 'succeeded',
      exitCode: 0,
      output: {ready: 'yes'},
    });

    expect(result).toEqual({
      kind: 'uncheckable',
      reason: 'gate expression evaluation failed',
      source,
      trace: degradedGateTrace(source, ['step']),
    });
  });

  test.each([
    [true, 'passed'],
    [false, 'failed'],
  ] as const)('dynamic boolean gate results remain checkable: %s', (ready, kind) => {
    const source = 'step.outputs.ready';
    const gate = readStepGate(gateConfig(source));

    const result = evaluateGate(gate, {
      status: 'succeeded',
      exitCode: 0,
      output: {ready},
    });

    expect(result).toEqual({kind, source, trace: gateTrace(source, ready)});
  });

  test('unguarded missing step output keys fail closed as uncheckable', () => {
    const gate = readStepGate(gateConfig('step.outputs.pass == true'));

    const result = evaluateGate(gate, {status: 'succeeded', exitCode: 0, output: {}});

    expect(result).toEqual({
      kind: 'uncheckable',
      reason: 'gate expression evaluation failed',
      source: 'step.outputs.pass == true',
      trace: [
        {
          expression: 'step.outputs.pass == true',
          roots: ['step'],
          fillTarget: 'step-report',
          evaluatedAt: 'step-report',
          value: 'false',
          degraded: true,
          field: 'step.success',
        },
      ],
    });
  });

  test('has-guarded missing step output keys evaluate as a checkable failure', () => {
    const source = 'has(step.outputs.pass) && step.outputs.pass == true';
    const gate = readStepGate(gateConfig(source));

    const result = evaluateGate(gate, {status: 'succeeded', exitCode: 0, output: {}});

    expect(result).toEqual({kind: 'failed', source, trace: gateTrace(source, false)});
  });

  test('a missing exit code is uncheckable (never evaluated)', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: null})).toEqual({
      kind: 'uncheckable',
      reason: 'step produced no exit code',
      source: 'step.exit_code == 0',
    });
  });

  test('an evaluation error is uncheckable, not a gate failure', () => {
    const gate = readStepGate(gateConfig('missing_var == 0'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toEqual({
      kind: 'uncheckable',
      reason: 'gate expression evaluation failed',
      source: 'missing_var == 0',
      trace: degradedGateTrace('missing_var == 0', ['missing_var']),
    });
  });
});

describe('evaluateGateFeedback', () => {
  test('returns literal feedback when no template was planned', () => {
    const gate = readStepGate({
      ...gateConfig('step.exit_code == 0'),
      gate: {
        success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
        on_failure: {restart_from: 'producer', feedback: 'try again'},
      },
    });
    const rule = gate?.onFailure?.[0];
    if (!rule) throw new Error('Expected rule');

    const result = evaluateGateFeedback({
      rule,
      result: {status: 'failed', exitCode: 1, output: {summary: 'unit failed'}},
      definitionId: 'definition-1',
    });

    expect(result).toBe('try again');
  });

  test('evaluates feedback templates against the reported step self-root', () => {
    const gate = readStepGate({
      ...gateConfig('step.exit_code == 0'),
      gate: {
        success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
        on_failure: {
          restart_from: 'producer',
          feedback: 'try again',
          feedback_template: feedbackTemplate(`failed: \${{ step.outputs.summary }}`),
        },
      },
    });
    const rule = gate?.onFailure?.[0];
    if (!rule) throw new Error('Expected rule');

    const result = evaluateGateFeedback({
      rule,
      result: {status: 'failed', exitCode: 1, output: {summary: 'unit failed'}},
      definitionId: 'definition-1',
    });

    expect(result).toBe('failed: unit failed');
  });
});

describe('gateResultPayload', () => {
  test('no-gate → null', () => {
    expect(gateResultPayload({kind: 'no-gate'}, 0)).toBeNull();
  });

  test('passed records the source and evaluated exit code', () => {
    expect(gateResultPayload({kind: 'passed', source: 'step.exit_code == 0'}, 0)).toEqual({
      passed: true,
      source: 'step.exit_code == 0',
      exit_code: 0,
    });
  });

  test('failed records the source and evaluated exit code', () => {
    expect(gateResultPayload({kind: 'failed', source: 'step.exit_code == 0'}, 1)).toEqual({
      passed: false,
      source: 'step.exit_code == 0',
      exit_code: 1,
    });
  });

  test('uncheckable records the source, reason, and a null exit code', () => {
    expect(
      gateResultPayload(
        {kind: 'uncheckable', reason: 'no exit code', source: 'step.exit_code == 0'},
        null,
      ),
    ).toEqual({
      passed: false,
      uncheckable: true,
      reason: 'no exit code',
      source: 'step.exit_code == 0',
      exit_code: null,
    });
  });

  test('uncheckable preserves an evaluation trace when the predicate ran', () => {
    expect(
      gateResultPayload(
        {
          kind: 'uncheckable',
          reason: 'gate expression evaluation failed',
          source: 'missing_var == 0',
          trace: degradedGateTrace('missing_var == 0', ['missing_var']),
        },
        0,
      ),
    ).toEqual({
      passed: false,
      uncheckable: true,
      reason: 'gate expression evaluation failed',
      source: 'missing_var == 0',
      exit_code: 0,
      trace: degradedGateTrace('missing_var == 0', ['missing_var']),
    });
  });
});

function rule(restartFrom: string, source?: string, extra: Record<string, unknown> = {}) {
  return {
    restart_from: restartFrom,
    ...(source === undefined ? {} : {if: {language: 'cel', check: 'syntax', source}}),
    ...extra,
  };
}

function ruleList(...rules: unknown[]) {
  return readStepGate({run: 'echo hi', gate: {on_failure: rules}});
}

describe('readStepGate rule lists', () => {
  test('reads a list in order with each rule condition', () => {
    const gate = ruleList(
      rule('a', 'step.exit_code == 1'),
      rule('b', undefined, {max_attempts: 2}),
    );

    expect(gate?.onFailure).toEqual([
      {
        if: {language: 'cel', check: 'syntax', source: 'step.exit_code == 1'},
        restartFrom: 'a',
      },
      {restartFrom: 'b', maxAttempts: 2},
    ]);
  });

  test('reads a single object as a one-rule list', () => {
    const gate = readStepGate({gate: {on_failure: rule('a')}});

    expect(gate?.onFailure).toEqual([{restartFrom: 'a'}]);
  });

  test.each([
    ['an empty list', []],
    ['a rule without restart_from', [{if: {source: 'true'}}]],
    ['a rule with a malformed condition', [rule('a'), {restart_from: 'b', if: 'true'}]],
    ['a rule with a malformed max_attempts', [rule('a'), rule('b', undefined, {max_attempts: 0})]],
  ])('drops the restart policy for %s', (_name, rules) => {
    expect(ruleList(...rules)).toBeUndefined();
  });
});

describe('selectRestartRule', () => {
  const failed = {status: 'failed' as const, exitCode: 1, output: {kind: 'transient'}};

  test('returns undefined without rules', () => {
    expect(selectRestartRule({gate: undefined, result: failed})).toBeUndefined();
  });

  test('returns undefined for a tool step', () => {
    const gate = ruleList(rule('a'));

    expect(selectRestartRule({gate, result: failed, stepType: 'tool'})).toBeUndefined();
  });

  test('selects the first rule with no condition', () => {
    const gate = ruleList(rule('a'), rule('b'));

    expect(selectRestartRule({gate, result: failed})).toMatchObject({
      kind: 'selected',
      position: 1,
      rule: {restartFrom: 'a'},
      trace: [],
    });
  });

  test('selects the first rule whose condition is true and keeps the trace', () => {
    const gate = ruleList(
      rule('a', 'step.outputs.kind == "fatal"'),
      rule('b', 'step.outputs.kind == "transient"'),
      rule('c'),
    );

    const selection = selectRestartRule({gate, result: failed});

    expect(selection).toMatchObject({kind: 'selected', position: 2, rule: {restartFrom: 'b'}});
    expect(selection?.trace.map((entry) => 'value' in entry && entry.value)).toEqual([
      'false',
      'true',
    ]);
  });

  test('reports no rule applied when every condition is false', () => {
    const gate = ruleList(rule('a', 'step.exit_code == 2'), rule('b', 'step.exit_code == 3'));

    expect(selectRestartRule({gate, result: failed})).toMatchObject({kind: 'none-applied'});
  });

  test('stops at a condition that cannot be evaluated and never tries later rules', () => {
    const gate = ruleList(rule('a', 'step.outputs.missing == "x"'), rule('b'));

    const selection = selectRestartRule({gate, result: failed});

    expect(selection).toMatchObject({
      kind: 'evaluation-failed',
      position: 1,
      source: 'step.outputs.missing == "x"',
      error: {message: expect.any(String)},
    });
  });

  test('a has() guard turns a missing key into false', () => {
    const gate = ruleList(
      rule('a', 'has(step.outputs.missing) && step.outputs.missing == "x"'),
      rule('b'),
    );

    expect(selectRestartRule({gate, result: failed})).toMatchObject({
      kind: 'selected',
      position: 2,
    });
  });
});

describe('gateResultPayload restart decision', () => {
  test('records the decision even when the gate has no success', () => {
    const payload = gateResultPayload({kind: 'no-gate'}, 1, {
      kind: 'selected',
      position: 2,
      rule: {restartFrom: 'prepare'},
      trace: [],
    });

    expect(payload).toEqual({
      exit_code: 1,
      restart: {kind: 'restart', rule: 2, restart_from: 'prepare'},
    });
  });

  test('records that no rule applied beside the gate outcome', () => {
    const payload = gateResultPayload({kind: 'failed', source: 'step.exit_code == 0'}, 1, {
      kind: 'none-applied',
      trace: [],
    });

    expect(payload).toEqual({
      passed: false,
      source: 'step.exit_code == 0',
      exit_code: 1,
      restart: {kind: 'none_applied'},
    });
  });

  test('names the rule that could not be evaluated and the error', () => {
    const payload = gateResultPayload({kind: 'no-gate'}, 1, {
      kind: 'evaluation-failed',
      position: 1,
      source: 'step.outputs.kind == "x"',
      error: {message: 'no such key', path: 'step.outputs.kind'},
      trace: [],
    });

    expect(payload).toEqual({
      exit_code: 1,
      restart: {
        kind: 'evaluation_failed',
        rule: 1,
        source: 'step.outputs.kind == "x"',
        error: {message: 'no such key', path: 'step.outputs.kind'},
      },
    });
  });
});
