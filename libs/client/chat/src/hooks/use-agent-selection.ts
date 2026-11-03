import {isErrorWithCode} from '@shipfox/client-api';
import {useCallback, useEffect, useState} from 'react';
import {isAgentUnavailable, SHIPPY_AGENT_KEY} from '#core/project-agents.js';
import {useProjectAgentsQuery} from './api/project-agents.js';

export const CONVERSATION_AGENT_UNAVAILABLE_CODE = 'conversation-agent-unavailable';

/**
 * Which agent the panel talks to. An existing conversation keeps the agent it was created with.
 * A new one takes the agent the user picks, or the built-in one when that agent is gone.
 */
export function useAgentSelection(params: {
  projectId: string;
  conversationId: string | undefined;
  /** The `agent_key` of the open conversation, once it has loaded. */
  conversationAgentKey: string | undefined;
  /** The latest failure of a send. A refused message tells the panel that the agent is gone. */
  sendError: unknown;
}) {
  const {projectId, conversationId, conversationAgentKey, sendError} = params;
  const {data: agents, refetch} = useProjectAgentsQuery(projectId);
  const agentRefused = isErrorWithCode(sendError, CONVERSATION_AGENT_UNAVAILABLE_CODE);
  useEffect(() => {
    if (agentRefused) void refetch();
  }, [agentRefused, refetch]);
  const [picked, setPicked] = useState(SHIPPY_AGENT_KEY);

  const newAgentKey = agents?.some((agent) => agent.key === picked) ? picked : SHIPPY_AGENT_KEY;
  const activeKey = conversationId ? conversationAgentKey : newAgentKey;
  const reset = useCallback(() => setPicked(SHIPPY_AGENT_KEY), []);

  return {
    agents,
    newAgentKey,
    pick: setPicked,
    reset,
    activeAgent: agents?.find((agent) => agent.key === activeKey),
    /** A conversation whose custom agent was deleted stays readable and takes no input. */
    agentGone: conversationId !== undefined && isAgentUnavailable({agentKey: activeKey, agents}),
  };
}
