import {Factory} from 'fishery';
import type {JobListenerSubscription} from '#core/entities/job-listener-subscription.js';
import {db} from '#db/db.js';
import {
  jobListenerSubscriptions,
  toJobListenerSubscription,
} from '#db/schema/job-listener-subscriptions.js';

export const jobListenerSubscriptionFactory = Factory.define<JobListenerSubscription>(
  ({sequence, onCreate}) => {
    onCreate(async (subscription) => {
      const [row] = await db()
        .insert(jobListenerSubscriptions)
        .values({
          workspaceId: subscription.workspaceId,
          workflowRunId: subscription.workflowRunId,
          jobId: subscription.jobId,
          kind: subscription.kind,
          matcherOrdinal: subscription.matcherOrdinal,
          source: subscription.source,
          event: subscription.event,
          config: subscription.config,
        })
        .returning();
      if (!row) throw new Error('Insert returned no rows');
      return toJobListenerSubscription(row);
    });

    return {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      kind: 'on',
      matcherOrdinal: sequence,
      source: 'github',
      event: 'push',
      config: {},
      createdAt: new Date(),
    };
  },
);
