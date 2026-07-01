import {lookup} from 'node:dns/promises';
import {assertEgressAllowed, EgressDeniedError, parseEgressHostDenylist} from './egress-guard.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);

describe('assertEgressAllowed', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    mockLookupAddresses([{address: '203.0.113.10', family: 4}]);
  });

  it('allows http and https URLs', async () => {
    await assertEgressAllowed('http://models.example.test/v1', lockedPolicy());
    await assertEgressAllowed('https://models.example.test/v1', lockedPolicy());

    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('rejects non-http URL schemes', async () => {
    const probe = assertEgressAllowed('ftp://models.example.test/v1', lockedPolicy());

    await expect(probe).rejects.toMatchObject({
      name: 'EgressDeniedError',
      reason: 'invalid-scheme',
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('checks IP literals without DNS resolution', async () => {
    await assertEgressAllowed('https://203.0.113.10/v1', lockedPolicy());

    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('resolves hostnames to all addresses', async () => {
    mockLookupAddresses([
      {address: '203.0.113.10', family: 4},
      {address: '2001:db8::1', family: 6},
    ]);

    await assertEgressAllowed('https://models.example.test/v1', lockedPolicy());

    expect(lookupMock).toHaveBeenCalledWith('models.example.test', {all: true});
  });

  it.each([
    ['loopback', 'http://127.0.0.1/v1'],
    ['rfc1918', 'http://10.0.0.12/v1'],
    ['metadata', 'http://169.254.169.254/latest/meta-data'],
    ['ipv6 link-local', 'http://[fe80::1]/v1'],
    ['ipv6 unique local', 'http://[fd00::1]/v1'],
  ])('rejects %s addresses when private networks are locked', async (_label, url) => {
    const probe = assertEgressAllowed(url, lockedPolicy());

    await expect(probe).rejects.toBeInstanceOf(EgressDeniedError);
  });

  it('rejects hostnames resolving to private addresses when private networks are locked', async () => {
    mockLookupAddresses([{address: '192.168.1.10', family: 4}]);

    const probe = assertEgressAllowed('https://models.example.test/v1', lockedPolicy());

    await expect(probe).rejects.toMatchObject({
      reason: 'private-network',
    });
  });

  it('rejects .internal hosts when private networks are locked', async () => {
    const probe = assertEgressAllowed('https://model-gateway.internal/v1', lockedPolicy());

    await expect(probe).rejects.toMatchObject({
      reason: 'internal-host',
    });
  });

  it('allows private and internal targets under the open policy', async () => {
    await assertEgressAllowed('http://localhost:11434/v1', openPolicy());
    await assertEgressAllowed('http://10.0.0.12/v1', openPolicy());
    await assertEgressAllowed('https://model-gateway.internal/v1', openPolicy());

    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('enforces exact hostname denylist entries', async () => {
    const probe = assertEgressAllowed('https://blocked.example.test/v1', {
      ...openPolicy(),
      hostDenylist: ['blocked.example.test'],
    });

    await expect(probe).rejects.toMatchObject({
      reason: 'host-denylist',
    });
  });

  it.each([
    '*.corp.example.test',
    '.corp.example.test',
  ])('enforces suffix denylist entry "%s"', async (entry) => {
    const probe = assertEgressAllowed('https://models.corp.example.test/v1', {
      ...openPolicy(),
      hostDenylist: [entry],
    });

    await expect(probe).rejects.toMatchObject({
      reason: 'host-denylist',
    });
  });

  it('enforces IP literal denylist entries', async () => {
    const probe = assertEgressAllowed('https://203.0.113.10/v1', {
      ...openPolicy(),
      hostDenylist: ['203.0.113.10'],
    });

    await expect(probe).rejects.toMatchObject({
      reason: 'host-denylist',
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('enforces CIDR denylist entries against resolved addresses', async () => {
    mockLookupAddresses([{address: '203.0.113.10', family: 4}]);

    const probe = assertEgressAllowed('https://models.example.test/v1', {
      ...openPolicy(),
      hostDenylist: ['203.0.113.0/24'],
    });

    await expect(probe).rejects.toMatchObject({
      reason: 'host-denylist',
    });
  });

  it('parses comma-separated host denylist config', () => {
    const entries = parseEgressHostDenylist(
      ' blocked.example.test, *.corp.example.test, 10.0.0.0/8 ',
    );

    expect(entries).toEqual(['blocked.example.test', '*.corp.example.test', '10.0.0.0/8']);
  });
});

function lockedPolicy() {
  return {allowPrivateNetworks: false};
}

function openPolicy() {
  return {allowPrivateNetworks: true};
}

function mockLookupAddresses(addresses: Array<{address: string; family: 4 | 6}>): void {
  lookupMock.mockResolvedValue(addresses as never);
}
