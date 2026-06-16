import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {WorkflowModel} from './workflow-model.js';

export type WorkflowSpec = WorkflowDocument;

export interface WorkflowDefinitionPayload {
  sourceYaml?: string | null;
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
  /**
   * Compatibility alias for packages that still consume the authoring document
   * before they migrate to `document`/`model`.
   */
  definition: WorkflowSpec;
  sourceYaml: string | null;
  document: WorkflowDocument;
  model: WorkflowModel;
  contentHash: string | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
