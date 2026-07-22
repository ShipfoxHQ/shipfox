import {describe, expect, it} from '@shipfox/vitest/vi';
import {toInvitationPreview} from './invitation-preview-mapper.js';

describe('toInvitationPreview', () => {
  it.each([
    [
      {
        status: 'pending' as const,
        workspace_id: '11111111-1111-4111-8111-111111111111',
        workspace_name: 'Acme',
        email: 'member@example.com',
        invited_by_display: 'Owner',
        expires_at: '2026-08-01T00:00:00.000Z',
      },
      {
        status: 'pending',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        workspaceName: 'Acme',
        email: 'member@example.com',
        invitedByDisplay: 'Owner',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    [
      {status: 'expired' as const, workspace_name: 'Acme', expires_at: '2026-08-01T00:00:00.000Z'},
      {status: 'expired', workspaceName: 'Acme', expiresAt: '2026-08-01T00:00:00.000Z'},
    ],
    [
      {status: 'already_used' as const, workspace_name: 'Acme'},
      {status: 'already_used', workspaceName: 'Acme'},
    ],
    [{status: 'invalid' as const}, {status: 'invalid'}],
  ])('maps %s previews into the invitation domain', (dto, expected) => {
    expect(toInvitationPreview(dto)).toEqual(expected);
  });
});
