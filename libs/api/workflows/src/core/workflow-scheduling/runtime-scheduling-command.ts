import type {RuntimeDagNode} from './runtime-dag.js';

export type RuntimeSchedulingCommand<Node extends RuntimeDagNode = RuntimeDagNode> =
  | {
      readonly kind: 'start-job';
      readonly job: Node;
    }
  | {
      readonly kind: 'evaluate-job-activation';
      readonly jobs: readonly Node[];
    }
  | {
      readonly kind: 'skip-job';
      readonly job: Node;
      readonly statusReason: 'default_gate_rejected';
    }
  | {
      readonly kind: 'complete-run';
      readonly status: 'succeeded' | 'failed';
    };
