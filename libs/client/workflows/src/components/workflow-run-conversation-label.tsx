import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
import {useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import type {WorkflowRunConversation} from '#core/workflow-run.js';
import {useMemberName} from '#hooks/api/member-name.js';

/** The built-in agent has a name to show. Another agent shows its file name. */
export function conversationAgentName(agentKey: string): string {
  return agentKey === 'shippy' ? 'Shippy' : agentKey;
}

/**
 * An agent in Slack or Linear started the run with no Shipfox user behind it. A web conversation
 * has no provider and always has an author.
 */
function startedByAgent(
  conversation: WorkflowRunConversation,
): conversation is WorkflowRunConversation & {provider: string} {
  return conversation.provider !== null && conversation.authorUserId === null;
}

function agentInProviderLabel(conversation: WorkflowRunConversation & {provider: string}): string {
  const provider = PROVIDER_CATALOG[conversation.provider]?.displayName ?? conversation.provider;
  return `${conversationAgentName(conversation.agentKey)} in ${provider}`;
}

/** For a run row: which agent started the run. The row has no room for the author. */
export function workflowRunViaLabel(conversation: WorkflowRunConversation): string {
  if (startedByAgent(conversation)) return `by ${agentInProviderLabel(conversation)}`;
  return `via ${conversationAgentName(conversation.agentKey)}`;
}

/**
 * For the run page: who the agent acted for, and which agent it was. It never links to the
 * conversation, which is private to its author.
 */
export function WorkflowRunConversationLabel({
  conversation,
  currentUserId,
  className,
}: {
  conversation: WorkflowRunConversation;
  currentUserId: string | undefined;
  className?: string | undefined;
}) {
  const workspace = useMaybeActiveWorkspace();
  const memberName = useMemberName(workspace?.id ?? '', conversation.authorUserId);
  const author =
    conversation.authorUserId !== null && conversation.authorUserId === currentUserId
      ? 'you'
      : memberName;
  const label = startedLabel(conversation, author);

  return (
    <Text as="span" size="xs" className={cn('min-w-0 truncate', className)}>
      {label}
    </Text>
  );
}

function startedLabel(conversation: WorkflowRunConversation, author: string | null): string {
  if (startedByAgent(conversation)) return `Started by ${agentInProviderLabel(conversation)}`;
  const agent = conversationAgentName(conversation.agentKey);
  return author ? `Started by ${author} via ${agent}` : `Started via ${agent}`;
}
