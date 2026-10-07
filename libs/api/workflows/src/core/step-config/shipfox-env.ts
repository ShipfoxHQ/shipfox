import {workflowRunUrl} from '@shipfox/api-workflows-dto';
import {config} from '#config.js';
import type {Step} from '#core/entities/step.js';

const SHIPFOX_ENV_STEP_TYPES: readonly Step['type'][] = ['run', 'action'];

export function stepReceivesShipfoxEnv(step: Pick<Step, 'type'>): boolean {
  return SHIPFOX_ENV_STEP_TYPES.includes(step.type);
}

/**
 * The run identity the runner sets on run and action steps. The runner applies it after the step
 * `env`, so a step cannot override it.
 */
export function runIdentityEnv(run: {
  readonly id: string;
  readonly number: number;
  readonly currentAttempt: number;
}): Record<string, string> {
  return {
    SHIPFOX_RUN_ID: run.id,
    SHIPFOX_RUN_NUMBER: String(run.number),
    SHIPFOX_RUN_ATTEMPT: String(run.currentAttempt),
    SHIPFOX_RUN_URL: workflowRunUrl({clientBaseUrl: config.CLIENT_BASE_URL, runId: run.id}),
  };
}
