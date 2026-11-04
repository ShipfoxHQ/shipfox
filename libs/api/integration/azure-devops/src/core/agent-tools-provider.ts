import {
  type AgentToolSession,
  type AgentToolsProvider,
  IntegrationProviderError,
  type OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {AzureDevOpsApiClient, AzureDevOpsRepositoryRef} from '#api/client.js';
import {
  type AzureDevOpsAgentToolCatalogEntry,
  type AzureDevOpsAgentToolRequiredScope,
  azureDevOpsAgentToolCatalog,
  azureDevOpsAgentToolSelectionCatalog,
  integerArgument,
  stringArgument,
  validateAzureDevOpsToolArguments,
} from './agent-tools.js';
import type {
  AzureDevOpsClientFactory,
  AzureDevOpsConnectionCredentials,
  AzureDevOpsIntegrationConnection,
} from './credentials.js';

export type AzureDevOpsToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

export interface AzureDevOpsAgentToolsProviderOptions {
  createClient: AzureDevOpsClientFactory;
  credentials: AzureDevOpsConnectionCredentials;
}

export class AzureDevOpsAgentToolsProvider
  implements
    AgentToolsProvider<
      AzureDevOpsIntegrationConnection,
      AzureDevOpsAgentToolRequiredScope,
      unknown,
      AzureDevOpsToolCallResult
    >
{
  constructor(private readonly options: AzureDevOpsAgentToolsProviderOptions) {}

  catalog() {
    return azureDevOpsAgentToolCatalog;
  }

  selectionCatalog() {
    return azureDevOpsAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<
      AzureDevOpsIntegrationConnection,
      AzureDevOpsAgentToolRequiredScope,
      unknown
    >,
  ): Promise<AgentToolSession<AzureDevOpsToolCallResult>> {
    const client = this.options.createClient({
      organization: input.connection.externalAccountId,
      credential: await this.options.credentials.resolve(input.connection),
    });

    return {
      call: async (call) => {
        const tool = input.tools.find((candidate) => candidate.id === call.toolId) as
          | AzureDevOpsAgentToolCatalogEntry
          | undefined;
        if (!tool) return toolError(`Unknown Azure DevOps tool: ${call.toolId}`, 'invalid-request');
        const validationError = validateAzureDevOpsToolArguments(tool, call.arguments);
        if (validationError) return toolError(validationError, 'invalid-request');
        try {
          return toolResult(await runTool(client, tool.id, call.arguments));
        } catch (error) {
          if (error instanceof IntegrationProviderError)
            return toolError(error.message, error.reason);
          throw error;
        }
      },
      close: () => Promise.resolve(),
    };
  }
}

async function runTool(
  client: AzureDevOpsApiClient,
  toolId: string,
  args: Record<string, unknown>,
): Promise<object> {
  // Azure DevOps accepts a project or repository name wherever it takes an id.
  const repository: AzureDevOpsRepositoryRef = {
    projectId: stringArgument(args, 'project'),
    repositoryId: stringArgument(args, 'repo'),
  };
  if (toolId === 'get_pull_request') {
    return await client.getPullRequest({
      ...repository,
      pullRequestId: integerArgument(args, 'pull_request_id'),
    });
  }
  if (toolId === 'create_pull_request') {
    return await client.createPullRequest({
      ...repository,
      sourceBranch: stringArgument(args, 'source_branch'),
      targetBranch: stringArgument(args, 'target_branch'),
      title: stringArgument(args, 'title'),
      description: typeof args.description === 'string' ? args.description : '',
      isDraft: args.is_draft !== false,
    });
  }
  if (toolId === 'comment_on_pull_request') {
    return await client.createPullRequestComment({
      ...repository,
      pullRequestId: integerArgument(args, 'pull_request_id'),
      content: stringArgument(args, 'content'),
    });
  }
  throw new TypeError(`Unknown Azure DevOps tool: ${toolId}`);
}

function toolResult(body: object): AzureDevOpsToolCallResult {
  return {
    content: [{type: 'text', text: JSON.stringify(body)}],
    structuredContent: {...body},
  };
}

function toolError(message: string, code: string): AzureDevOpsToolCallResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent: {code},
  };
}
