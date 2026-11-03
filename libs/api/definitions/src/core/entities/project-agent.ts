import type {AgentThinking, WorkflowDocumentStepIntegration} from '@shipfox/workflow-document';

/**
 * The last valid version of an agent file. `instructions` is the text the
 * file's parts joined to at the synced commit, so a `file` part is read once.
 */
export interface ProjectAgentConfig {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  thinking?: AgentThinking | undefined;
  integrations?: WorkflowDocumentStepIntegration[] | undefined;
}

export interface ProjectAgentError {
  message: string;
  path?: string | undefined;
}

export interface ProjectAgent {
  id: string;
  projectId: string;
  /** The file name without the extension. */
  key: string;
  configPath: string;
  config: ProjectAgentConfig;
  contentHash: string;
  /** Why the file at `configPath` is invalid now. `config` still holds the last valid version. */
  errors: ProjectAgentError[];
  createdAt: Date;
  updatedAt: Date;
}
