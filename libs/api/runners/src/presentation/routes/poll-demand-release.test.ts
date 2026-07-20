import {AUTH_PROVISIONER_TOKEN, setProvisionerContext} from '@shipfox/api-auth-context';
import {type AuthMethod, closeApp, createApp, extractBearerToken} from '@shipfox/node-fastify';
import {vi} from '@shipfox/vitest/vi';
import {and, eq} from 'drizzle-orm';
import type {FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {reservations} from '#db/schema/reservations.js';
import {pendingJobFactory} from '#test/index.js';

const VALID_PROVISIONER_TOKEN = 'valid-provisioner-token';

describe('POST /provisioners/demand/poll reservation cleanup', () => {
  it('rolls back granted reservations if loading terminate intents throws', async () => {
    vi.resetModules();
    const listProvisionerTerminateIntentRowsTx = vi
      .fn()
      .mockRejectedValueOnce(new Error('db unavailable'));
    vi.doMock('#db/runner-instances.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('#db/runner-instances.js')>()),
      listProvisionerTerminateIntentRowsTx,
    }));
    const {pollDemandRoute} = await import('./poll-demand.js');
    const workspaceId = crypto.randomUUID();
    const provisionerTokenId = crypto.randomUUID();
    const provisionerAuth: AuthMethod = {
      name: AUTH_PROVISIONER_TOKEN,
      authenticate: (request: FastifyRequest) => {
        if (extractBearerToken(request.headers.authorization) !== VALID_PROVISIONER_TOKEN) {
          throw new Error('unauthorized');
        }
        setProvisionerContext(request, {scope: 'workspace', workspaceId, provisionerTokenId});
        return Promise.resolve();
      },
    };
    const app = await createApp({
      auth: [provisionerAuth],
      routes: [{prefix: '/provisioners', auth: AUTH_PROVISIONER_TOKEN, routes: [pollDemandRoute]}],
      swagger: false,
    });
    await app.ready();
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/provisioners/demand/poll',
        headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
        payload: {
          wait_seconds: 0,
          max_reservations: 1,
          templates: [
            {
              template_key: 'linux',
              labels: ['linux'],
              available_slots: 1,
              starting: 0,
              running: 0,
            },
          ],
        },
      });

      const reservationRows = await db()
        .select()
        .from(reservations)
        .where(
          and(
            eq(reservations.workspaceId, workspaceId),
            eq(reservations.provisionerId, provisionerTokenId),
          ),
        );
      expect(res.statusCode).toBe(500);
      expect(reservationRows).toHaveLength(0);
    } finally {
      vi.doUnmock('#db/runner-instances.js');
      vi.resetModules();
      await closeApp();
    }
  });
});
