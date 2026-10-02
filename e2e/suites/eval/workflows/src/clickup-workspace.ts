import type {RecordedWrite} from '@shipfox/e2e-core';
import {type ClickUpTaskFixture, startClickUpApiMock} from '@shipfox/e2e-driver-clickup';
import {createClickUpConnection} from '@shipfox/e2e-setup-integrations';
import {createClickUpEventSender} from './clickup-events.js';
import type {ClickUpTaskSeed} from './schema.js';
import type {EventSender} from './senders.js';

function taskFixture(task: ClickUpTaskSeed): ClickUpTaskFixture {
  return {
    id: task.id,
    name: task.name,
    url: `https://app.clickup.com/t/${task.id}`,
    markdownDescription: task.description ?? '',
  };
}

export interface ClickUpWorkspace {
  /** The slug the composed workflow's tracker connection uses. */
  connectionSlug: string;
  sender: EventSender;
  /** Every write the ClickUp fake accepted, as `clickup.<tool>` entries. Read before it stops. */
  writes: () => RecordedWrite[];
}

/**
 * A ClickUp connection in the case's workspace, and the fake behind it. The fake serves the seeded
 * tasks and records the writes the workflow makes to them. The API reaches it by the connection's
 * access token, so cases that use ClickUp can run together.
 */
export async function arrangeClickUpWorkspace({
  workspaceId,
  uniqueId,
  tasks,
  cleanups,
}: {
  workspaceId: string;
  uniqueId: string;
  tasks: readonly ClickUpTaskSeed[];
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}): Promise<ClickUpWorkspace> {
  const accessToken = `clickup-access-token-${uniqueId}`;
  const mock = await startClickUpApiMock({accessToken, tasks: tasks.map(taskFixture)});
  cleanups.push(() => mock.stop());

  const webhookId = `eval-webhook-${uniqueId}`;
  const webhookSecret = `eval-secret-${uniqueId}`;
  const authorizingUserId = `eval-user-${uniqueId}`;
  const connection = await createClickUpConnection({
    workspaceId,
    teamId: `eval-team-${uniqueId}`,
    teamName: `Eval ClickUp ${uniqueId}`,
    authorizingUserId,
    accessToken,
    webhookId,
    webhookSecret,
    displayName: `Eval ClickUp ${uniqueId}`,
  });

  return {
    connectionSlug: connection.slug,
    sender: createClickUpEventSender({
      connectionId: connection.id,
      webhookId,
      webhookSecret,
      actorId: authorizingUserId,
      tasks,
    }),
    writes: () => mock.writes().map((write) => ({...write, kind: `clickup.${write.kind}`})),
  };
}
