import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {WorkflowModel} from './workflow-model.js';

export interface WorkflowDefinitionPayload {
  document: WorkflowDocument;
  model: WorkflowModel;
}

export interface WorkflowDefinition {
  id: string;
  projectId: string;
  configPath: string | null;
  source: 'manual' | 'vcs';
  sha: string | null;
  ref: string | null;
  name: string;
  document: WorkflowDocument;
  model: WorkflowModel;
  contentHash: string | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
