import type {ProvisionerTokenDto} from '@shipfox/api-runners-dto';
import {
  formatProvisionerTokenDate,
  formatProvisionerTokenTimestamp,
  provisionerConnectionStatus,
  provisionerTokenDisplayName,
} from './provisioner-token-format.js';

const token: ProvisionerTokenDto = {
  id: '33333333-3333-4333-8333-333333333333',
  scope: 'workspace',
  workspace_id: '11111111-1111-4111-8111-111111111111',
  prefix: 'sf_pt_abcde',
  name: 'Docker provisioner',
  created_by_user_id: '22222222-2222-4222-8222-222222222222',
  revoked_by_user_id: null,
  expires_at: '2026-05-09T00:00:00.000Z',
  revoked_at: null,
  last_seen_at: null,
  created_at: '2026-05-08T00:00:00.000Z',
  updated_at: '2026-05-08T00:00:00.000Z',
};

describe('provisionerTokenDisplayName', () => {
  test('uses the token name when present', () => {
    const result = provisionerTokenDisplayName(token);

    expect(result).toBe('Docker provisioner');
  });

  test('falls back for unnamed tokens', () => {
    const result = provisionerTokenDisplayName({...token, name: null});

    expect(result).toBe('Unnamed provisioner');
  });
});

describe('formatProvisionerTokenDate', () => {
  test('formats timestamps as dates', () => {
    const result = formatProvisionerTokenDate('2026-05-08T00:00:00.000Z');

    expect(result).not.toBe('Never');
    expect(result).not.toContain(':');
  });

  test('formats null as never', () => {
    const result = formatProvisionerTokenDate(null);

    expect(result).toBe('Never');
  });
});

describe('formatProvisionerTokenTimestamp', () => {
  test('formats timestamps with time', () => {
    const result = formatProvisionerTokenTimestamp('2026-05-08T00:00:00.000Z');

    expect(result).toContain(':');
  });

  test('formats null as undefined', () => {
    const result = formatProvisionerTokenTimestamp(null);

    expect(result).toBeUndefined();
  });
});

describe('provisionerConnectionStatus', () => {
  test('returns connected when the token id is active', () => {
    const result = provisionerConnectionStatus(token, new Set([token.id]));

    expect(result).toEqual({kind: 'connected', dotVariant: 'success', label: 'Connected'});
  });

  test('returns last seen when inactive with a last seen timestamp', () => {
    const result = provisionerConnectionStatus(
      {...token, last_seen_at: '2026-05-08T01:00:00.000Z'},
      new Set(),
    );

    expect(result).toEqual({
      kind: 'last-seen',
      dotVariant: 'neutral',
      label: 'Last seen',
      lastSeenAt: '2026-05-08T01:00:00.000Z',
    });
  });

  test('returns never connected when inactive with no last seen timestamp', () => {
    const result = provisionerConnectionStatus(token, new Set());

    expect(result).toEqual({
      kind: 'never-connected',
      dotVariant: 'neutral',
      label: 'Never connected',
    });
  });
});
