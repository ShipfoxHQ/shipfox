import type {RecordedWrite} from '@shipfox/e2e-core';
import {type LinearIssueFixture, startLinearMcpMock} from '@shipfox/e2e-driver-linear';
import {createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {createLinearEventSender} from './linear-events.js';
import type {LinearIssueSeed} from './schema.js';
import type {EventSender} from './senders.js';

function issueFixture(issue: LinearIssueSeed): LinearIssueFixture {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    team: {key: issue.team},
    labels: issue.labels.map((name) => ({name})),
    url: `https://linear.app/e2e/issue/${issue.identifier}`,
  };
}

export interface LinearWorkspace {
  /** The slug the composed workflow's tracker connection uses. */
  connectionSlug: string;
  sender: EventSender;
  /** Every write the Linear fake accepted, as `linear.<tool>` entries. Read before it stops. */
  writes: () => RecordedWrite[];
}

/**
 * A Linear connection in the case's workspace, and the fake behind it. The fake serves the seeded
 * issues and records the writes the workflow makes to them.
 */
export async function arrangeLinearWorkspace({
  workspaceId,
  uniqueId,
  issues,
  cleanups,
}: {
  workspaceId: string;
  uniqueId: string;
  issues: readonly LinearIssueSeed[];
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}): Promise<LinearWorkspace> {
  const accessToken = `lin_oauth_${uniqueId}`;
  const mock = await startLinearMcpMock({
    accessToken,
    workspace: {
      issues: Object.fromEntries(issues.map((issue) => [issue.identifier, issueFixture(issue)])),
      documents: {},
      comments: {},
    },
  });
  cleanups.push(() => mock.stop());

  const organizationId = `eval-org-${uniqueId}`;
  const appUserId = `eval-app-${uniqueId}`;
  const connection = await createLinearConnection({
    workspaceId,
    organizationId,
    organizationUrlKey: `eval-${uniqueId}`,
    appUserId,
    displayName: `Eval Linear ${uniqueId}`,
    accessToken,
  });

  return {
    connectionSlug: connection.slug,
    sender: createLinearEventSender({organizationId, appUserId, issues}),
    writes: () => mock.writes().map((write) => ({...write, kind: `linear.${write.kind}`})),
  };
}
