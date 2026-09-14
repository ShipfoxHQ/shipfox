import {
  WORKFLOWS_WORKFLOW_CONCURRENCY_HOLDER_CANCELLATION_REQUESTED,
  WORKFLOWS_WORKFLOW_CONCURRENCY_WAITER_SUPERSEDED,
} from '@shipfox/api-workflows-dto';
import {createWorkflowsModule} from './index.js';

const handlers = vi.hoisted(() => ({
  holderCancellationRequested: vi.fn(),
  waiterSuperseded: vi.fn(),
}));

vi.mock('#presentation/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#presentation/index.js')>()),
  onWorkflowRunConcurrencyHolderCancellationRequested: handlers.holderCancellationRequested,
  onWorkflowRunConcurrencyWaiterSuperseded: handlers.waiterSuperseded,
}));

function createModule() {
  return createWorkflowsModule({
    agent: {} as never,
    definitions: {} as never,
    annotations: {} as never,
    auth: {} as never,
    integrations: {} as never,
    logs: {} as never,
    projects: {} as never,
    runners: {} as never,
    secrets: {} as never,
    workspaces: {} as never,
  });
}

describe('createWorkflowsModule', () => {
  beforeEach(() => {
    handlers.holderCancellationRequested.mockReset().mockResolvedValue(undefined);
    handlers.waiterSuperseded.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    {
      event: WORKFLOWS_WORKFLOW_CONCURRENCY_WAITER_SUPERSEDED,
      handler: handlers.waiterSuperseded,
      payload: {
        projectId: crypto.randomUUID(),
        claimId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        supersededByClaimId: crypto.randomUUID(),
        supersededByWorkflowRunId: crypto.randomUUID(),
        supersededByWorkflowRunAttemptId: crypto.randomUUID(),
      },
    },
    {
      event: WORKFLOWS_WORKFLOW_CONCURRENCY_HOLDER_CANCELLATION_REQUESTED,
      handler: handlers.holderCancellationRequested,
      payload: {
        projectId: crypto.randomUUID(),
        claimId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        requestingClaimId: crypto.randomUUID(),
        requestingWorkflowRunId: crypto.randomUUID(),
        requestingWorkflowRunAttemptId: crypto.randomUUID(),
      },
    },
  ])('registers the $event subscriber', async ({event, handler, payload}) => {
    const subscriber = createModule().subscribers?.find((candidate) => candidate.event === event);
    if (!subscriber) throw new Error(`Expected ${event} subscriber`);

    const domainEvent = {id: crypto.randomUUID(), type: event, payload, createdAt: new Date()};
    await subscriber.handler(domainEvent);

    expect(handler).toHaveBeenCalledWith(payload, domainEvent);
  });
});
