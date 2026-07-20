import {assignCapacityBatch as assignCapacityBatchDb} from '#db/capacity-assignments.js';
import type {CapacityAssignment} from './entities/capacity-assignment.js';

export function assignCapacityBatch(params: {
  provisionerId: string;
  reservationId: string;
  capacityIds: string[];
}): Promise<CapacityAssignment[]> {
  return assignCapacityBatchDb(params);
}
