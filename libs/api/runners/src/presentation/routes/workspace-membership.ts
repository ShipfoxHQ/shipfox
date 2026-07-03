import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {FastifyRequest} from 'fastify';

export function requireManualRegistrationTokenWorkspaceMembership(params: {
  request: FastifyRequest;
  workspaceId: string;
}): void {
  requireWorkspaceAccess(params);
}
