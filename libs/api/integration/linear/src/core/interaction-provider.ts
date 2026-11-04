import type {
  IntegrationConnection,
  Interaction,
  InteractionProvider,
  InteractionReplyOutcome,
  InteractionRole,
  ReadInteractionInput,
  ReportInteractionProgressInput,
  SendInteractionReplyInput,
} from '@shipfox/api-integration-spi';
import {z} from 'zod';
import type {LinearApiClient} from '#api/client.js';
import {LinearIntegrationProviderError} from '#core/errors.js';
import type {LinearTokenStore} from '#core/tokens.js';

export const LINEAR_AGENT_SESSION_CREATED = 'agentSession.created';
export const LINEAR_AGENT_SESSION_PROMPTED = 'agentSession.prompted';

const LINEAR_REPLY_GUIDANCE = [
  'You are answering inside a Linear agent session, usually on an issue.',
  'The person sees your reply in the session next to the issue, so lead with the answer or the outcome and keep it short.',
  'Write Markdown. Refer to issues by identifier, such as ENG-123, and link to anything you mention.',
  'Skip greetings and sign-offs, and do not repeat the issue title back.',
].join(' ');

const userSchema = z.object({id: z.string().min(1), name: z.string().nullish()}).passthrough();

const agentSessionEventSchema = z
  .object({
    agentSession: z
      .object({
        id: z.string().min(1),
        comment: z.object({}).passthrough().nullish(),
        creator: userSchema.nullish(),
        issue: z
          .object({
            id: z.string().nullish(),
            identifier: z.string().nullish(),
            teamId: z.string().nullish(),
            team: z
              .object({id: z.string().nullish(), key: z.string().nullish()})
              .passthrough()
              .nullish(),
            project: z
              .object({id: z.string().nullish(), name: z.string().nullish()})
              .passthrough()
              .nullish(),
            labels: z.array(z.object({name: z.string()}).passthrough()).nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
    promptContext: z.string().nullish(),
    agentActivity: z
      .object({
        signal: z.string().nullish(),
        body: z.string().nullish(),
        content: z.object({body: z.string().nullish()}).passthrough().nullish(),
        user: userSchema.nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

type AgentSessionEvent = z.infer<typeof agentSessionEventSchema>;

interface LinearRequestContext {
  trigger: 'mention' | 'delegation';
  team_id: string | null;
  team_key: string | null;
  labels: string[];
  project_id: string | null;
  project_name: string | null;
  issue_identifier: string | null;
}

export const linearRequestContextSchema = {
  type: 'object',
  properties: {
    trigger: {
      type: 'string',
      enum: ['mention', 'delegation'],
      description: 'A comment that mentions the app is a mention, an assignment is a delegation.',
    },
    team_id: {type: ['string', 'null']},
    team_key: {type: ['string', 'null']},
    labels: {type: 'array', items: {type: 'string'}, description: 'Label names on the issue.'},
    project_id: {type: ['string', 'null']},
    project_name: {type: ['string', 'null']},
    issue_identifier: {type: ['string', 'null']},
  },
  required: [
    'trigger',
    'team_id',
    'team_key',
    'labels',
    'project_id',
    'project_name',
    'issue_identifier',
  ],
} as const;

export interface LinearInteractionProviderOptions {
  linear: Pick<
    LinearApiClient,
    'getIssueContext' | 'createAgentActivity' | 'setAgentSessionExternalUrls'
  >;
  tokenStore: Pick<LinearTokenStore, 'getAccessToken'>;
}

export class LinearInteractionProvider
  implements InteractionProvider<IntegrationConnection<'linear'>>
{
  readonly interactionEvents = {
    [LINEAR_AGENT_SESSION_CREATED]: 'request',
    [LINEAR_AGENT_SESSION_PROMPTED]: 'follow_up',
  } as const satisfies Record<string, InteractionRole>;
  readonly requestContextSchema: Record<string, unknown> = linearRequestContextSchema;
  readonly replyGuidance = LINEAR_REPLY_GUIDANCE;

  constructor(private readonly options: LinearInteractionProviderOptions) {}

  async readInteraction({
    connection,
    event,
    payload,
  }: ReadInteractionInput<IntegrationConnection<'linear'>>): Promise<Interaction | undefined> {
    const parsed = agentSessionEventSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    const data = parsed.data;
    const conversationKey = data.agentSession.id;

    if (event === LINEAR_AGENT_SESSION_CREATED) {
      return {
        conversationKey,
        role: 'request',
        context: {...(await this.readRequestContext(connection.id, data))},
        author: readAuthor(data.agentSession.creator),
        text: data.promptContext ?? '',
      };
    }

    if (event !== LINEAR_AGENT_SESSION_PROMPTED) return undefined;
    const activity = data.agentActivity;
    const author = readAuthor(activity?.user ?? data.agentSession.creator);
    if (activity?.signal === 'stop') {
      return {conversationKey, role: 'stop', context: {}, author, text: ''};
    }
    const text = activity?.body ?? activity?.content?.body ?? '';
    if (text.trim() === '') return undefined;
    return {conversationKey, role: 'follow_up', context: {}, author, text};
  }

  /**
   * Linear sets a session's state from its last activity, so a reply is a `response` or an
   * `error` activity. The agent's name is not used: the activity belongs to the app.
   */
  async sendReply({
    connection,
    conversationKey,
    kind,
    text,
  }: SendInteractionReplyInput<IntegrationConnection<'linear'>>): Promise<InteractionReplyOutcome> {
    let accessToken: string;
    try {
      accessToken = await this.options.tokenStore.getAccessToken({connectionId: connection.id});
    } catch (error) {
      // A refused refresh is a lost authorization, but a malformed refresh response is Linear
      // misbehaving, so only the first settles the reply.
      if (error instanceof LinearIntegrationProviderError && error.reason === 'access-denied') {
        return {outcome: 'undeliverable', reason: error.message};
      }
      throw error;
    }
    try {
      await this.options.linear.createAgentActivity({
        accessToken,
        agentSessionId: conversationKey,
        content: {type: kind, body: text},
      });
    } catch (error) {
      if (isRejectedByLinear(error)) return {outcome: 'undeliverable', reason: error.message};
      throw error;
    }
    return {outcome: 'delivered'};
  }

  /**
   * Shows a tool call as an ephemeral `action` activity, which the next activity replaces, and
   * puts links on the session. `idle` posts nothing: every turn ends with a reply, which clears
   * the action.
   */
  async reportProgress({
    connection,
    conversationKey,
    state,
    detail,
    links,
  }: ReportInteractionProgressInput<IntegrationConnection<'linear'>>): Promise<void> {
    if (state === 'idle') return;
    const accessToken = await this.options.tokenStore.getAccessToken({
      connectionId: connection.id,
    });
    if (links && links.length > 0) {
      await this.options.linear.setAgentSessionExternalUrls({
        accessToken,
        agentSessionId: conversationKey,
        urls: links,
      });
    }
    if (detail !== undefined) {
      await this.options.linear.createAgentActivity({
        accessToken,
        agentSessionId: conversationKey,
        content: {type: 'action', action: detail, parameter: ''},
        ephemeral: true,
      });
    }
  }

  private async readRequestContext(
    connectionId: string,
    data: AgentSessionEvent,
  ): Promise<LinearRequestContext> {
    const issue = data.agentSession.issue;
    const trigger = data.agentSession.comment ? 'mention' : 'delegation';
    const teamId = issue?.team?.id ?? issue?.teamId ?? null;
    const teamKey = issue?.team?.key ?? null;
    const identifier = issue?.identifier ?? null;
    const labels = issue?.labels?.map((label) => label.name);

    // A payload without labels or a project key can't tell "none" from "not sent", so ask the API.
    const complete =
      teamId !== null &&
      teamKey !== null &&
      identifier !== null &&
      labels !== undefined &&
      issue?.project !== undefined;
    if (complete || !issue?.id) {
      return {
        trigger,
        team_id: teamId,
        team_key: teamKey,
        labels: labels ?? [],
        project_id: issue?.project?.id ?? null,
        project_name: issue?.project?.name ?? null,
        issue_identifier: identifier,
      };
    }

    const accessToken = await this.options.tokenStore.getAccessToken({connectionId});
    const fetched = await this.options.linear.getIssueContext({accessToken, issueId: issue.id});
    return {
      trigger,
      team_id: fetched.teamId,
      team_key: fetched.teamKey,
      labels: fetched.labels,
      project_id: fetched.projectId,
      project_name: fetched.projectName,
      issue_identifier: fetched.identifier,
    };
  }
}

/** Linear refused the activity, so sending it again can't help. Other failures are retried. */
function isRejectedByLinear(error: unknown): error is LinearIntegrationProviderError {
  return (
    error instanceof LinearIntegrationProviderError &&
    (error.reason === 'access-denied' || error.reason === 'malformed-provider-response')
  );
}

function readAuthor(
  user: {id: string; name?: string | null | undefined} | null | undefined,
): Interaction['author'] {
  if (!user) return undefined;
  return {externalId: user.id, ...(user.name ? {displayName: user.name} : {})};
}
