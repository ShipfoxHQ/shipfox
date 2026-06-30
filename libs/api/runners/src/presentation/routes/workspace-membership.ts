import {requireMembership} from '@shipfox/api-workspaces';
import type {FastifyRequest} from 'fastify';

export function requireManualRegistrationTokenWorkspaceMembership(params: {
  request: FastifyRequest;
  workspaceId: string;
}): Promise<unknown> {
  return requireMembership(params);
}
