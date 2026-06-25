import {
  e2eCreateInvitationBodySchema,
  e2eCreateInvitationResponseSchema,
} from '@shipfox/api-workspaces-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {createInvitation} from '#db/invitations.js';
import {toInvitationDto} from '#presentation/dto/index.js';

const INVITATION_TTL_DAYS = 7;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export const createE2eInvitationRoute = defineRoute({
  method: 'POST',
  path: '/invitations',
  description: 'Create a workspace invitation for E2E tests.',
  schema: {
    body: e2eCreateInvitationBodySchema,
    response: {
      201: e2eCreateInvitationResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const rawToken = generateOpaqueToken('invitation');
    const invitation = await createInvitation({
      workspaceId: request.body.workspace_id,
      email: request.body.email,
      hashedToken: hashOpaqueToken(rawToken),
      expiresAt: daysFromNow(INVITATION_TTL_DAYS),
      invitedByUserId: request.body.invited_by_user_id,
      invitedByDisplay: request.body.invited_by_display ?? null,
      skipEmail: true,
    });

    reply.code(201);
    return {
      invitation: toInvitationDto(invitation),
      raw_token: rawToken,
    };
  },
});
