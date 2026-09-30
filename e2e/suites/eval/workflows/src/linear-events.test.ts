import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import {createLinearEventSender, type LinearDelivery} from './linear-events.js';
import type {LinearIssueSeed} from './schema.js';
import type {EventSenderContext} from './senders.js';

const postAgentSession = vi.fn<LinearDelivery['postAgentSession']>();
const postIssueUpdate = vi.fn<LinearDelivery['postIssueUpdate']>();
const waitForRun = vi.fn<LinearDelivery['waitForRun']>();
const describeDecisions = vi.fn<LinearDelivery['describeDecisions']>();
const delivery: LinearDelivery = {
  postAgentSession,
  postIssueUpdate,
  waitForRun,
  describeDecisions,
};

const context: EventSenderContext = {
  workspaceId: 'workspace',
  projectId: 'project',
  connectionId: 'connection',
  token: 'token',
  repository: 'acme/report-cli',
};
const issue: LinearIssueSeed = {
  id: 'eval-issue-7',
  identifier: 'ENG-7',
  title: 'Add a --json flag',
  description: 'Scripts need JSON.',
  team: 'ENG',
  labels: ['bug'],
};
const options = {organizationId: 'org-1', appUserId: 'app-1', issues: [issue], delivery};
const run = {id: 'run'} as Awaited<ReturnType<LinearDelivery['waitForRun']>>;
const unseededPattern = /seeds no Linear issue ENG-9/u;
const invalidPattern = /agentSession\.created payload is invalid/u;
const unknownEventPattern = /cannot send Comment\.create events/u;
const noRunPattern = /No run started from the signed Linear deliveries/u;

describe('createLinearEventSender', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    describeDecisions.mockResolvedValue('Trigger decisions: none.');
  });

  it('sends an agent session for the seeded issue and returns the delivery that started a run', async () => {
    postAgentSession.mockResolvedValueOnce('delivery-1');
    waitForRun.mockResolvedValueOnce(run);
    const send = createLinearEventSender(options);

    const delivery = await send({
      event: 'agentSession.created',
      payload: {issue: 'ENG-7'},
      context,
    });

    expect(delivery).toEqual({deliveryId: 'delivery-1'});
    expect(postAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        organizationId: 'org-1',
        appUserId: 'app-1',
        issue: expect.objectContaining({
          id: 'eval-issue-7',
          identifier: 'ENG-7',
          teamKey: 'ENG',
          description: 'Scripts need JSON.',
        }),
      }),
    );
  });

  it('adds the label to the issue and sends the labels it had before', async () => {
    postIssueUpdate.mockResolvedValueOnce('delivery-2');
    waitForRun.mockResolvedValueOnce(run);
    const send = createLinearEventSender(options);

    await send({
      event: 'Issue.update',
      payload: {issue: 'ENG-7', added_label: 'shipfox'},
      context,
    });

    expect(postIssueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        previousLabelIds: ['eval-label-bug'],
        issue: expect.objectContaining({
          labels: [
            {id: 'eval-label-bug', name: 'bug'},
            {id: 'eval-label-shipfox', name: 'shipfox'},
          ],
        }),
      }),
    );
  });

  it('sends again when a delivery starts no run, because the subscription was not active yet', async () => {
    postAgentSession.mockResolvedValueOnce('too-early').mockResolvedValueOnce('delivery-3');
    waitForRun.mockRejectedValueOnce(new Error('No run.')).mockResolvedValueOnce(run);
    const send = createLinearEventSender(options);

    const delivery = await send({
      event: 'agentSession.created',
      payload: {issue: 'ENG-7'},
      context,
    });

    expect(delivery).toEqual({deliveryId: 'delivery-3'});
    expect(postAgentSession).toHaveBeenCalledTimes(2);
  });

  it('fails after the last delivery when no run ever starts', async () => {
    postAgentSession.mockResolvedValue('never');
    waitForRun.mockRejectedValue(new Error('No run.'));
    const send = createLinearEventSender(options);

    await expect(
      send({event: 'agentSession.created', payload: {issue: 'ENG-7'}, context}),
    ).rejects.toThrow(noRunPattern);
    expect(describeDecisions).toHaveBeenCalledWith({deliveryId: 'never', context});
  });

  it('rejects an issue the case did not seed', async () => {
    const send = createLinearEventSender(options);

    await expect(
      send({event: 'agentSession.created', payload: {issue: 'ENG-9'}, context}),
    ).rejects.toThrow(unseededPattern);
  });

  it('rejects a payload with an unknown field', async () => {
    const send = createLinearEventSender(options);

    await expect(
      send({event: 'agentSession.created', payload: {issue: 'ENG-7', comment: 'x'}, context}),
    ).rejects.toThrow(invalidPattern);
  });

  it('rejects an event it cannot send', async () => {
    const send = createLinearEventSender(options);

    await expect(send({event: 'Comment.create', payload: {}, context})).rejects.toThrow(
      unknownEventPattern,
    );
  });
});
