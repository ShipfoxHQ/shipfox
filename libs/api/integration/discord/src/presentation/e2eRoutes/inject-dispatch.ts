import {injectE2eDiscordDispatchBodySchema} from '@shipfox/api-integration-discord-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {DispatchHandlers} from '#core/gateway-dispatch-queue.js';
import type {DiscordInstallation} from '#db/installations.js';

export interface InjectE2eDiscordDispatchRouteOptions {
  /** The handlers the Gateway service runs, so an injected dispatch takes the same path. */
  handlers: DispatchHandlers;
  getDiscordInstallationByConnectionId: (
    connectionId: string,
  ) => Promise<DiscordInstallation | undefined>;
}

export function createE2eDiscordInjectDispatchRoute(options: InjectE2eDiscordDispatchRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/discord-dispatches',
    description: 'Run a Gateway dispatch through the Gateway handlers for E2E tests.',
    schema: {
      body: injectE2eDiscordDispatchBodySchema,
      response: {204: z.void()},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const name = body.dispatch.t ?? body.dispatch.type;
      const data = body.dispatch.d ?? body.dispatch.data;
      const handler = name === undefined ? undefined : options.handlers[name];
      if (name === undefined || handler === undefined || data === undefined) {
        throw new ClientError(
          'The dispatch needs a name with a Gateway handler and its data',
          'discord-dispatch-invalid',
          {status: 400},
        );
      }
      const installation = await options.getDiscordInstallationByConnectionId(body.connection_id);
      if (!installation) {
        throw new ClientError('Discord connection not found', 'discord-connection-not-found', {
          status: 404,
        });
      }

      await handler(
        {
          op: 0,
          t: name,
          s: body.sequence ?? body.dispatch.s ?? 0,
          // The connection decides the server, so a payload cannot route to another installation.
          d: {...data, guild_id: installation.guildId},
        } as Parameters<typeof handler>[0],
        {sessionId: body.session_id},
      );
      reply.code(204);
    },
  });
}
