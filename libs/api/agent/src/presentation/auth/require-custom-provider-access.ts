import {requireMembership} from '@shipfox/api-workspaces';
import type {FastifyRequest} from '@shipfox/node-fastify';

export async function requireCustomProviderAccess(params: {
  request: FastifyRequest;
  workspaceId: string;
}): Promise<void> {
  await requireMembership(params);
}
