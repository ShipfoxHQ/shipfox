import type {RuntimeCompletionStatus, RuntimeDagNode} from './runtime-dag.js';

export type RuntimeSchedulingCommand<Node extends RuntimeDagNode = RuntimeDagNode> =
  | {
      readonly kind: 'start-job';
      readonly job: Node;
    }
  | {
      readonly kind: 'skip-job';
      readonly job: Node;
    }
  | {
      readonly kind: 'complete-run';
      readonly status: RuntimeCompletionStatus;
    };
