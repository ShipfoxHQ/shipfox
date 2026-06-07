import {readFileSync} from 'node:fs';
import type {RuntimeCommand} from './runtime-command.js';
import type {RuntimeEvent} from './runtime-event.js';
import type {RuntimeState} from './runtime-state.js';

export interface RuntimeGoldenTrace {
  name: string;
  initialState: RuntimeState;
  steps: Array<{
    event: RuntimeEvent;
    commands: RuntimeCommand[];
  }>;
  finalState: RuntimeState;
}

export type RuntimeGoldenTraceReference = Readonly<{
  fileName: string;
  purpose: string;
}>;

export const runtimeGoldenTraceReferences: readonly RuntimeGoldenTraceReference[] = [
  {
    fileName: 'minimal-success.json',
    purpose: 'Single root job succeeds and completes the run.',
  },
  {
    fileName: 'job-failure-cancels-dependent.json',
    purpose: 'Failed prerequisite cancels its pending dependent and fails the run.',
  },
];

export function readRuntimeGoldenTrace(fileName: string): RuntimeGoldenTrace {
  return JSON.parse(
    readFileSync(new URL(`./traces/${fileName}`, import.meta.url), 'utf8'),
  ) as RuntimeGoldenTrace;
}
