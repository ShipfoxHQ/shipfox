import {readdirSync} from 'node:fs';
import type {RuntimeCommand} from './runtime-command.js';
import {
  readRuntimeGoldenTrace,
  runtimeGoldenTraceReferences,
} from './runtime-golden-trace-reference.js';
import {transitionRuntimeState} from './transition.js';

describe.each(runtimeGoldenTraceReferences)('runtime golden trace $fileName', ({fileName}) => {
  test('replays deterministically', () => {
    const trace = readRuntimeGoldenTrace(fileName);
    let state = trace.initialState;
    const commands: RuntimeCommand[][] = [];

    for (const step of trace.steps) {
      const result = transitionRuntimeState(state, step.event);
      state = result.state;
      commands.push(result.commands);
    }

    expect(commands).toEqual(trace.steps.map((step) => step.commands));
    expect(state).toEqual(trace.finalState);
  });
});

describe('runtimeGoldenTraceReferences', () => {
  test('registers every committed runtime trace', () => {
    const traceFiles = readdirSync(new URL('./traces/', import.meta.url))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort();
    const registeredTraceFiles = runtimeGoldenTraceReferences
      .map((reference) => reference.fileName)
      .sort();

    expect(registeredTraceFiles).toEqual(traceFiles);
  });
});
