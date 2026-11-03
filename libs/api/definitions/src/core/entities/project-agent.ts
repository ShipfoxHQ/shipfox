import type {AgentDocument} from '@shipfox/workflow-document';
import type {ValidationDiagnostic} from './validation-diagnostic.js';

/**
 * The last valid configuration of one agent file, keyed by the file name
 * without its extension. `instructions` holds the joined prompt, with each
 * `file` part inlined from the definition commit, so a reader needs no
 * repository access.
 */
export interface ProjectAgent {
  id: string;
  projectId: string;
  key: string;
  configPath: string;
  name: string | null;
  description: string | null;
  instructions: string | null;
  document: AgentDocument;
  contentHash: string;
  /** The error of the latest sync, when its file was invalid and this row kept the last valid version. */
  lastError: ProjectAgentError | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectAgentError {
  message: string;
  diagnostics: ValidationDiagnostic[];
}
