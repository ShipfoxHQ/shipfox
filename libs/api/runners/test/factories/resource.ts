import {Factory} from 'fishery';
import type {Resource} from '#core/entities/resource.js';
import {db} from '#db/db.js';
import {resources} from '#db/schema/resources.js';

export const resourceFactory = Factory.define<Resource>(({onCreate}) => {
  onCreate(async (resource) => {
    const [row] = await db()
      .insert(resources)
      .values({
        workspaceId: resource.workspaceId,
        provisionerId: resource.provisionerId,
        resourceId: resource.resourceId,
        reservationId: resource.reservationId,
        templateKey: resource.templateKey,
        labels: resource.labels,
        state: resource.state,
        reason: resource.reason,
        runnerSessionId: resource.runnerSessionId,
        providerKind: resource.providerKind,
        reportedAt: resource.reportedAt,
        reservationReleasedAt: resource.reservationReleasedAt,
      })
      .returning();

    if (!row) throw new Error('Insert returned no rows');
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      provisionerId: row.provisionerId,
      resourceId: row.resourceId,
      reservationId: row.reservationId,
      templateKey: row.templateKey,
      labels: row.labels,
      state: row.state,
      reason: row.reason,
      runnerSessionId: row.runnerSessionId,
      providerKind: row.providerKind,
      reportedAt: row.reportedAt,
      reservationReleasedAt: row.reservationReleasedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provisionerId: crypto.randomUUID(),
    resourceId: crypto.randomUUID(),
    reservationId: null,
    templateKey: 'linux',
    labels: ['linux'],
    state: 'running',
    reason: null,
    runnerSessionId: null,
    providerKind: 'docker',
    reportedAt: new Date(),
    reservationReleasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
