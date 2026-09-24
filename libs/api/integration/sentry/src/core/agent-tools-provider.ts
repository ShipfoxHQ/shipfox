import type {
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {SentrySearchIssuesInput} from '#api/client.js';
import {
  boundedSentryToolResult,
  projectSentryEvent,
  projectSentryIssue,
  projectSentryProject,
  type SentryToolResult,
} from '#core/agent-tool-results.js';
import {
  sentryAgentToolCatalog,
  sentryAgentToolSelectionCatalog,
  sentryToolInputs,
} from '#core/agent-tools.js';
import type {SentryReadClient} from '#core/read-client.js';

type SentryConnection = IntegrationConnection<'sentry'>;
type SentryCallResult =
  | (ReturnType<typeof boundedSentryToolResult> & {isError?: false})
  | {
      isError: true;
      content: {type: 'text'; text: string}[];
      structuredContent: {code: 'invalid-request'};
    };
type SentryCall = Parameters<AgentToolSession<SentryCallResult>['call']>[0];

export class SentryAgentToolsProvider
  implements AgentToolsProvider<SentryConnection, 'read', unknown, SentryCallResult>
{
  constructor(private readonly readClient: SentryReadClient) {}

  catalog() {
    return sentryAgentToolCatalog;
  }

  selectionCatalog() {
    return sentryAgentToolSelectionCatalog;
  }

  openSession(
    input: OpenAgentToolsSessionInput<SentryConnection, 'read'>,
  ): Promise<AgentToolSession<SentryCallResult>> {
    return Promise.resolve({
      call: (call) =>
        this.call(
          input.connection.id,
          input.tools.map((tool) => tool.id),
          call,
        ),
    });
  }

  private async call(
    connectionId: string,
    selectedTools: string[],
    call: SentryCall,
  ): Promise<SentryCallResult> {
    if (!selectedTools.includes(call.toolId)) return invalidRequest();

    let result: SentryToolResult | undefined;
    switch (call.toolId) {
      case 'list-projects': {
        result = await this.listProjects(connectionId, call.arguments);
        break;
      }
      case 'search-issues': {
        result = await this.searchIssues(connectionId, call.arguments);
        break;
      }
      case 'get-issue': {
        result = await this.getIssue(connectionId, call.arguments);
        break;
      }
      case 'get-issue-event': {
        result = await this.getIssueEvent(connectionId, call.arguments);
        break;
      }
      default:
        return invalidRequest();
    }
    return result ? boundedSentryToolResult(result) : invalidRequest();
  }

  private async listProjects(
    connectionId: string,
    arguments_: Record<string, unknown>,
  ): Promise<SentryToolResult | undefined> {
    const parsed = sentryToolInputs['list-projects'].safeParse(arguments_);
    if (!parsed.success) return undefined;
    const args = {
      connectionId,
      ...(parsed.data.query === undefined ? {} : {query: parsed.data.query}),
      ...(parsed.data.limit === undefined ? {} : {limit: parsed.data.limit}),
      ...(parsed.data.cursor === undefined ? {} : {cursor: parsed.data.cursor}),
    };
    const [page, sourceUrl] = await Promise.all([
      this.readClient.listProjects(args),
      this.readClient.sourceUrl(connectionId, 'projects'),
    ]);
    return {
      data: page.data.map(projectSentryProject),
      nextCursor: page.nextCursor,
      truncated: false,
      sourceUrl,
    };
  }

  private async searchIssues(
    connectionId: string,
    arguments_: Record<string, unknown>,
  ): Promise<SentryToolResult | undefined> {
    const parsed = sentryToolInputs['search-issues'].safeParse(arguments_);
    if (!parsed.success) return undefined;
    const input = parsed.data;
    const args: {connectionId: string} & SentrySearchIssuesInput = {
      connectionId,
      query: input.query ?? 'is:unresolved',
      sort: input.sort ?? 'date',
      limit: input.limit ?? 20,
      ...(input.projectIds === undefined ? {} : {projectIds: input.projectIds}),
      ...(input.environments === undefined ? {} : {environments: input.environments}),
      ...(input.start === undefined ? {} : {start: input.start}),
      ...(input.end === undefined ? {} : {end: input.end}),
      ...(input.start === undefined ? {statsPeriod: input.statsPeriod ?? '24h'} : {}),
      ...(input.cursor === undefined ? {} : {cursor: input.cursor}),
    };
    const [page, sourceUrl] = await Promise.all([
      this.readClient.searchIssues(args),
      this.readClient.sourceUrl(connectionId, 'issues'),
    ]);
    return {
      data: page.data.map(projectSentryIssue),
      nextCursor: page.nextCursor,
      truncated: false,
      sourceUrl,
    };
  }

  private async getIssue(
    connectionId: string,
    arguments_: Record<string, unknown>,
  ): Promise<SentryToolResult | undefined> {
    const parsed = sentryToolInputs['get-issue'].safeParse(arguments_);
    if (!parsed.success) return undefined;
    const [issue, sourceUrl] = await Promise.all([
      this.readClient.getIssue({connectionId, issueId: parsed.data.issueId}),
      this.readClient.sourceUrl(connectionId, 'issues', parsed.data.issueId),
    ]);
    return {data: projectSentryIssue(issue), nextCursor: null, truncated: false, sourceUrl};
  }

  private async getIssueEvent(
    connectionId: string,
    arguments_: Record<string, unknown>,
  ): Promise<SentryToolResult | undefined> {
    const parsed = sentryToolInputs['get-issue-event'].safeParse(arguments_);
    if (!parsed.success) return undefined;
    const args = {
      connectionId,
      issueId: parsed.data.issueId,
      ...(parsed.data.eventId === undefined ? {} : {eventId: parsed.data.eventId}),
      ...(parsed.data.environments === undefined ? {} : {environments: parsed.data.environments}),
    };
    const [event, sourceUrl] = await Promise.all([
      this.readClient.getIssueEvent(args),
      this.readClient.sourceUrl(connectionId, 'issues', parsed.data.issueId),
    ]);
    const projected = projectSentryEvent(event);
    return {data: projected.data, nextCursor: null, truncated: projected.truncated, sourceUrl};
  }
}

function invalidRequest(): SentryCallResult {
  return {
    isError: true,
    content: [{type: 'text', text: 'Invalid Sentry tool or arguments'}],
    structuredContent: {code: 'invalid-request'},
  };
}
