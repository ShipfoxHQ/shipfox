import {
  type AgentInterModuleClient,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {getSessionClaimHolderStatus} from '#db/workflow-runs/steps.js';
import {AgentStepSessionClaimError} from './errors.js';
import {isTerminal} from './step-transition/decide-step-transition.js';

/** Null leaves the persisted claim pending for the next runner pull. */
export async function claimSessionWithReconciliation(
  params: Parameters<AgentInterModuleClient['claimSession']>[0] & {agent: AgentInterModuleClient},
): Promise<Awaited<ReturnType<AgentInterModuleClient['claimSession']>> | null> {
  const {agent, ...input} = params;
  let reconciled = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await agent.claimSession(input);
    } catch (error) {
      const action = await recoverClaimError({error, input, agent, reconciled, attempt});
      if (action === 'wait') return null;
      if (action === 'reconciled') reconciled = true;
    }
  }
}

async function recoverClaimError(params: {
  error: unknown;
  input: Parameters<AgentInterModuleClient['claimSession']>[0];
  agent: AgentInterModuleClient;
  reconciled: boolean;
  attempt: number;
}): Promise<'wait' | 'retry' | 'reconciled'> {
  const {error, input, agent, reconciled, attempt} = params;
  if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, error)) throw error;
  if (reconciled && error.code === 'session-lock-unavailable') return 'wait';
  if (error.code !== 'session-held' || input.mode !== 'resume') throw error;
  const holder = error.details.holder;
  if (holder === undefined) {
    if (attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    return 'retry';
  }
  const disposition = await classifyHolder(input, holder.stepAttemptId);
  if (disposition === 'unknown') throw error;
  if (disposition === 'wait' || reconciled) return 'wait';

  // Do not swallow release failures: the persisted dispatch must remain recoverable.
  const {released} = await agent.releaseSession(holder);
  logger().info(
    {event: 'workflows.session_claim_reconciled', ...holder, released},
    'Reconciled agent session claim held by a terminal attempt',
  );
  return 'reconciled';
}

async function classifyHolder(
  input: Parameters<AgentInterModuleClient['claimSession']>[0],
  holderAttemptId: string,
): Promise<'terminal' | 'unknown' | 'wait'> {
  if (holderAttemptId === input.stepAttemptId) return 'wait';
  const status = await getSessionClaimHolderStatus({...input, stepAttemptId: holderAttemptId});
  if (status === 'running') {
    throw new AgentStepSessionClaimError(
      'agent_session_held',
      'Agent session is held by another running attempt',
    );
  }
  return status !== null && isTerminal(status) ? 'terminal' : 'unknown';
}
