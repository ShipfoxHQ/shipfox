import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {FastifyRequest} from '@shipfox/node-fastify';

export function requireCustomProviderAccess(params: {
  request: FastifyRequest;
  workspaceId: string;
}): void {
  requireWorkspaceAccess(params);
}
