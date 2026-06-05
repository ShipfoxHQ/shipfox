import {readFileSync} from 'node:fs';
import type {RuntimeCommand} from './runtime-command.js';
import type {RuntimeEvent} from './runtime-event.js';
import type {RuntimeState} from './runtime-state.js';
import {transitionRuntimeState} from './transition.js';

interface RuntimeGoldenTrace {
  name: string;
  initialState: RuntimeState;
  steps: Array<{
    event: RuntimeEvent;
    commands: RuntimeCommand[];
  }>;
  finalState: RuntimeState;
}

describe.each([
  'minimal-success.json',
  'job-failure-cancels-dependent.json',
] satisfies string[])('runtime golden trace %s', (fileName) => {
  test('replays deterministically', () => {
    const trace = readTrace(fileName);
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

function readTrace(fileName: string): RuntimeGoldenTrace {
  return JSON.parse(
    readFileSync(new URL(`./traces/${fileName}`, import.meta.url), 'utf8'),
  ) as RuntimeGoldenTrace;
}
