import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import {type ClickUpDelivery, createClickUpEventSender} from './clickup-events.js';
import type {ClickUpTaskSeed} from './schema.js';
import type {EventSenderContext} from './senders.js';

const post = vi.fn<ClickUpDelivery['post']>();
const waitForRun = vi.fn<ClickUpDelivery['waitForRun']>();
const describeDecisions = vi.fn<ClickUpDelivery['describeDecisions']>();
const delivery: ClickUpDelivery = {post, waitForRun, describeDecisions};

const context: EventSenderContext = {
  workspaceId: 'workspace',
  projectId: 'project',
  connectionId: 'connection',
  token: 'token',
  repository: 'acme/report-cli',
};
const task: ClickUpTaskSeed = {id: '86abc', name: 'Add a --json flag', list: 'list-1'};
const options = {
  connectionId: 'clickup-connection',
  webhookId: 'webhook-1',
  webhookSecret: 'secret-1',
  actorId: 'user-1',
  tasks: [task],
  delivery,
};
const run = {id: 'run'} as Awaited<ReturnType<ClickUpDelivery['waitForRun']>>;
const unseededPattern = /seeds no ClickUp task 86xyz/u;
const invalidPattern = /taskTagUpdated payload is invalid/u;
const unknownEventPattern = /cannot send taskCommentPosted events/u;
const noRunPattern = /No run started from the signed ClickUp deliveries/u;

describe('createClickUpEventSender', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    describeDecisions.mockResolvedValue('Trigger decisions: none.');
  });

  it('sends a tag update on the seeded task and returns the delivery that started a run', async () => {
    post.mockResolvedValueOnce('delivery-1');
    waitForRun.mockResolvedValueOnce(run);
    const send = createClickUpEventSender(options);

    const sent = await send({
      event: 'taskTagUpdated',
      payload: {task: '86abc', tag: 'shipfox'},
      context,
    });

    expect(sent).toEqual({deliveryId: 'delivery-1'});
    expect(post).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        event: 'taskTagUpdated',
        webhook_id: 'webhook-1',
        task_id: '86abc',
        history_items: [
          expect.objectContaining({
            field: 'tag',
            parent_id: 'list-1',
            after: [expect.objectContaining({name: 'shipfox'})],
          }),
        ],
      }),
      webhookSecret: 'secret-1',
      connectionId: 'clickup-connection',
    });
  });

  it('sends a status update that moves the seeded task to the status', async () => {
    post.mockResolvedValueOnce('delivery-2');
    waitForRun.mockResolvedValueOnce(run);
    const send = createClickUpEventSender(options);

    await send({
      event: 'taskStatusUpdated',
      payload: {task: '86abc', status: 'ready for dev'},
      context,
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          event: 'taskStatusUpdated',
          history_items: [
            expect.objectContaining({
              field: 'status',
              parent_id: 'list-1',
              before: expect.objectContaining({status: 'to do'}),
              after: expect.objectContaining({status: 'ready for dev'}),
            }),
          ],
        }),
      }),
    );
  });

  it('sends again with a new history item when a delivery starts no run', async () => {
    post.mockResolvedValueOnce('too-early').mockResolvedValueOnce('delivery-3');
    waitForRun.mockRejectedValueOnce(new Error('No run.')).mockResolvedValueOnce(run);
    const send = createClickUpEventSender(options);

    const sent = await send({
      event: 'taskTagUpdated',
      payload: {task: '86abc', tag: 'shipfox'},
      context,
    });

    const historyItemIds = post.mock.calls.map(
      ([{envelope}]) => envelope.history_items[0]?.id as string,
    );
    expect(sent).toEqual({deliveryId: 'delivery-3'});
    expect(new Set(historyItemIds).size).toBe(2);
  });

  it('fails after the last delivery when no run ever starts', async () => {
    let delivered = 0;
    post.mockImplementation(() => {
      delivered += 1;
      return Promise.resolve(`delivery-${delivered}`);
    });
    waitForRun.mockRejectedValue(new Error('No run.'));
    const send = createClickUpEventSender(options);

    await expect(
      send({event: 'taskTagUpdated', payload: {task: '86abc', tag: 'shipfox'}, context}),
    ).rejects.toThrow(noRunPattern);
    expect(post).toHaveBeenCalledTimes(6);
    expect(describeDecisions).toHaveBeenCalledWith({deliveryId: 'delivery-6', context});
  });

  it('rethrows the abort when the step is cut off while waiting for a run', async () => {
    const controller = new AbortController();
    const aborted = new Error('The step timed out.');
    post.mockResolvedValueOnce('delivery-1');
    waitForRun.mockImplementationOnce(() => {
      controller.abort(aborted);
      return Promise.reject(aborted);
    });
    const send = createClickUpEventSender(options);

    await expect(
      send({
        event: 'taskTagUpdated',
        payload: {task: '86abc', tag: 'shipfox'},
        context,
        signal: controller.signal,
      }),
    ).rejects.toBe(aborted);
    expect(post).toHaveBeenCalledTimes(1);
    expect(describeDecisions).not.toHaveBeenCalled();
  });

  it('rejects a task the case did not seed', async () => {
    const send = createClickUpEventSender(options);

    await expect(
      send({event: 'taskTagUpdated', payload: {task: '86xyz', tag: 'shipfox'}, context}),
    ).rejects.toThrow(unseededPattern);
  });

  it('rejects a payload with an unknown field', async () => {
    const send = createClickUpEventSender(options);

    await expect(
      send({
        event: 'taskTagUpdated',
        payload: {task: '86abc', tag: 'shipfox', status: 'x'},
        context,
      }),
    ).rejects.toThrow(invalidPattern);
  });

  it('rejects an event it cannot send', async () => {
    const send = createClickUpEventSender(options);

    await expect(send({event: 'taskCommentPosted', payload: {}, context})).rejects.toThrow(
      unknownEventPattern,
    );
  });
});
