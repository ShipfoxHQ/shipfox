import {integrationSourceCommitPushedSchema} from './events.js';

const validCommitPushed = {
  provider: 'github',
  workspaceId: 'ws-1',
  connectionId: 'conn-1',
  deliveryId: 'delivery-1',
  receivedAt: '2026-06-21T00:00:00.000Z',
  push: {
    externalRepositoryId: 'acme/repo',
    ref: 'refs/heads/main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
  },
};

describe('integrationSourceCommitPushedSchema', () => {
  it('parses a valid commit-pushed payload unchanged', () => {
    const result = integrationSourceCommitPushedSchema.parse(validCommitPushed);

    expect(result).toEqual(validCommitPushed);
  });

  it('rejects a payload missing a top-level field', () => {
    const {provider: _provider, ...withoutProvider} = validCommitPushed;

    const parse = () => integrationSourceCommitPushedSchema.parse(withoutProvider);

    expect(parse).toThrow();
  });

  it('rejects a payload missing a nested push field', () => {
    const {headCommitSha: _headCommitSha, ...pushWithoutSha} = validCommitPushed.push;
    const input = {...validCommitPushed, push: pushWithoutSha};

    const parse = () => integrationSourceCommitPushedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('strips unknown keys (tolerant of forward-compatible producer additions)', () => {
    const input = {...validCommitPushed, addedLater: 'ignored'};

    const result = integrationSourceCommitPushedSchema.parse(input);

    expect(result).toEqual(validCommitPushed);
  });
});
