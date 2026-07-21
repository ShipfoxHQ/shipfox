import {assignRunnerInstances as assignRunnerInstancesDb} from '#db/runner-assignments.js';

export function assignRunnerInstances(params: {
  provisionerId: string;
  reservationId: string;
  runnerInstanceIds: string[];
}): Promise<string[]> {
  return assignRunnerInstancesDb(params);
}
