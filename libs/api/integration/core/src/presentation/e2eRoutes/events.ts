import {
  e2eListIntegrationEventsQuerySchema,
  e2eListIntegrationEventsResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {and, asc, eq, type SQL, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';

export const createE2eIntegrationEventsRoute = defineRoute({
  method: 'GET',
  path: '/events',
  description: 'Read integration outbox rows for E2E assertions.',
  schema: {
    querystring: e2eListIntegrationEventsQuerySchema,
    response: {
      200: e2eListIntegrationEventsResponseSchema,
    },
  },
  handler: async (request) => {
    const conditions: SQL[] = [];
    if (request.query.event_type) {
      conditions.push(eq(integrationsOutbox.eventType, request.query.event_type));
    }
    if (request.query.delivery_id) {
      conditions.push(
        sql`${integrationsOutbox.payload} ->> 'deliveryId' = ${request.query.delivery_id}`,
      );
    }

    const rows = await db()
      .select({
        id: integrationsOutbox.id,
        eventType: integrationsOutbox.eventType,
        payload: integrationsOutbox.payload,
        createdAt: integrationsOutbox.createdAt,
      })
      .from(integrationsOutbox)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(integrationsOutbox.createdAt));

    return {
      events: rows.map((row) => ({
        id: row.id,
        event_type: row.eventType,
        payload: row.payload as Record<string, unknown>,
        created_at: row.createdAt.toISOString(),
      })),
    };
  },
});
