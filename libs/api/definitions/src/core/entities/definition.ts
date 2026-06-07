import type {
  SurfaceJob,
  SurfaceRunStep,
  SurfaceTrigger,
  SurfaceWorkflowDocument,
} from '@shipfox/api-workflow-language';

export type Trigger = SurfaceTrigger;
export type RunStep = SurfaceRunStep;
export type Job = SurfaceJob;
export type {SurfaceWorkflowDocument};

export interface WorkflowDefinition {
  id: string;
  projectId: string;
  configPath: string | null;
  source: 'manual' | 'vcs';
  sha: string | null;
  ref: string | null;
  name: string;
  definition: SurfaceWorkflowDocument;
  contentHash: string | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
