import {defineAction} from '@shipfox/actions';

// The runner process has these, and so do run steps. An action must not.
const RUNNER_ONLY = [
  'SHIPFOX_API_URL',
  'NODE_OPTIONS',
  'SHIPFOX_ACTIONS_TOKEN',
  'SHIPFOX_ACTION_INPUTS',
];
const STEP_ENV = {
  WORKFLOW_LEVEL: 'from-workflow',
  JOB_LEVEL: 'from-job',
  STEP_LEVEL: 'from-step',
};

export default defineAction(({log}) => {
  const leaked = Object.keys(process.env).filter(
    (key) => key.startsWith('SHIPFOX_RUNNER_') || RUNNER_ONLY.includes(key),
  );
  if (leaked.length > 0)
    throw new Error(`Runner variables reached the action: ${leaked.join(', ')}`);

  for (const [key, expected] of Object.entries(STEP_ENV)) {
    if (process.env[key] !== expected) {
      throw new Error(`${key} is ${JSON.stringify(process.env[key])}, expected ${expected}`);
    }
  }
  log.info('environment holds the step env and no runner variables');
  return undefined;
});
