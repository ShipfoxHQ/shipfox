import type {AnnotationStyleDto} from '@shipfox/annotations-dto';

export interface Annotation {
  id: string;
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  context: string;
  style: AnnotationStyleDto;
  body: string;
  bodyBytes: number;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}
