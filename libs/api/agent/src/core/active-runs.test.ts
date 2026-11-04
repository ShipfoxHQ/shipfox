import {eq, inArray} from 'drizzle-orm';
import {db} from '#db/db.js';
import {registerConversationRun, requestRunLinkChecks} from '#db/run-links.js';
import {conversationRunLinks} from '#db/schema/conversation-run-links.js';
import {conversations} from '#db/schema/conversations.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {jobOverview, runOverview} from '#test/fixtures/run-overview.js';
import {listActiveRuns} from './active-runs.js';
import {deliverRunResults} from './deliver-run-results.js';

type Overview = ReturnType<typeof runOverview>;

describe('listActiveRuns', () => {
  const conversationIds: string[] = [];
  const overviews = new Map<string, Overview | null>();
  const unreadable = new Set<string>();
  const getWorkflowRunOverview = vi.fn((input: {workflowRunId: string}) => {
    if (unreadable.has(input.workflowRunId)) {
      return Promise.reject(new Error('workflows is down'));
    }
    return Promise.resolve(overviews.get(input.workflowRunId) ?? null);
  });
  const workflows = {getWorkflowRunOverview} as never;
  const wake = vi.fn(async (_conversationId: string) => undefined);

  beforeEach(() => {
    overviews.clear();
    unreadable.clear();
    getWorkflowRunOverview.mockClear();
  });

  afterEach(async () => {
    if (conversationIds.length > 0) {
      await db().delete(conversations).where(inArray(conversations.id, conversationIds));
    }
    conversationIds.length = 0;
  });

  async function arrangeConversation() {
    const {conversation} = await conversationFactory.create();
    conversationIds.push(conversation.id);
    return conversation;
  }

  async function startRun(conversation: {id: string; workspaceId: string}) {
    const workflowRunId = crypto.randomUUID();
    await registerConversationRun({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      workflowRunId,
    });
    return workflowRunId;
  }

  function list(conversation: {id: string; workspaceId: string}) {
    return listActiveRuns({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      workflows,
    });
  }

  it('lists a run that just started, before any check has seen it', async () => {
    const conversation = await arrangeConversation();
    const workflowRunId = await startRun(conversation);
    overviews.set(workflowRunId, runOverview({runId: workflowRunId, status: 'pending'}));

    const runs = await list(conversation);

    expect(runs).toEqual([
      {
        workflowRunId,
        runNumber: 7,
        name: 'Implement',
        attempt: 1,
        status: 'pending',
        startedAt: expect.any(String),
        jobsFinished: 0,
        jobsTotal: 0,
      },
    ]);
  });

  it('counts the finished jobs of the attempt', async () => {
    const conversation = await arrangeConversation();
    const workflowRunId = await startRun(conversation);
    overviews.set(
      workflowRunId,
      runOverview({
        runId: workflowRunId,
        jobs: [
          jobOverview({key: 'build', status: 'succeeded'}),
          jobOverview({key: 'test', status: 'running'}),
        ],
      }),
    );

    const [run] = await list(conversation);

    expect(run).toMatchObject({jobsFinished: 1, jobsTotal: 2});
  });

  it('drops a run once its result is delivered', async () => {
    const conversation = await arrangeConversation();
    const workflowRunId = await startRun(conversation);
    overviews.set(workflowRunId, runOverview({runId: workflowRunId, status: 'succeeded'}));
    await deliverRunResults({workflowRunId, workflows, wake});
    getWorkflowRunOverview.mockClear();

    const runs = await list(conversation);

    expect(runs).toEqual([]);
    expect(getWorkflowRunOverview).not.toHaveBeenCalled();
  });

  it('drops a settled run before its result lands, so it never reads as running', async () => {
    const conversation = await arrangeConversation();
    const workflowRunId = await startRun(conversation);
    overviews.set(
      workflowRunId,
      runOverview({
        runId: workflowRunId,
        jobs: [
          jobOverview({key: 'build', status: 'succeeded'}),
          jobOverview({
            key: 'review',
            mode: 'listening',
            status: 'running',
            listenerStatus: 'listening',
          }),
        ],
      }),
    );

    expect(await list(conversation)).toEqual([]);
  });

  it('lists a rerun again until its own attempt delivers', async () => {
    const conversation = await arrangeConversation();
    const workflowRunId = await startRun(conversation);
    overviews.set(workflowRunId, runOverview({runId: workflowRunId, attempt: 1, status: 'failed'}));
    await deliverRunResults({workflowRunId, workflows, wake});

    overviews.set(
      workflowRunId,
      runOverview({runId: workflowRunId, attempt: 2, status: 'running'}),
    );
    await requestRunLinkChecks(workflowRunId);
    await deliverRunResults({workflowRunId, workflows, wake});

    expect(await list(conversation)).toEqual([
      expect.objectContaining({workflowRunId, attempt: 2, status: 'running'}),
    ]);
  });

  it('drops a delivered attempt that the link has not recorded yet', async () => {
    const conversation = await arrangeConversation();
    const workflowRunId = await startRun(conversation);
    const attemptId = crypto.randomUUID();
    overviews.set(
      workflowRunId,
      runOverview({runId: workflowRunId, attemptId, status: 'succeeded'}),
    );
    await deliverRunResults({workflowRunId, workflows, wake});
    // A result stored before links recorded their attempt, with the run still being read as open.
    await db()
      .update(conversationRunLinks)
      .set({latestAttemptId: null})
      .where(eq(conversationRunLinks.workflowRunId, workflowRunId));
    overviews.set(workflowRunId, runOverview({runId: workflowRunId, attemptId}));

    expect(await list(conversation)).toEqual([]);
  });

  it('leaves out a run that Workflows cannot read, and keeps the others', async () => {
    const conversation = await arrangeConversation();
    const missing = await startRun(conversation);
    const failing = await startRun(conversation);
    const workflowRunId = await startRun(conversation);
    overviews.set(missing, null);
    unreadable.add(failing);
    overviews.set(workflowRunId, runOverview({runId: workflowRunId}));

    const runs = await list(conversation);

    expect(runs.map((run) => run.workflowRunId)).toEqual([workflowRunId]);
  });
});
