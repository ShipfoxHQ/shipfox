import type {ChildProcess} from 'node:child_process';
import {EventEmitter} from 'node:events';

const mocks = vi.hoisted(() => ({
  closeSync: vi.fn(),
  createApiClient: vi.fn(),
  openSync: vi.fn(),
  pollUntil: vi.fn(),
  requestJson: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', async (importActual) => ({
  ...(await importActual<typeof import('node:child_process')>()),
  spawn: (...args: unknown[]) => mocks.spawn(...args),
}));

vi.mock('node:fs', async (importActual) => ({
  ...(await importActual<typeof import('node:fs')>()),
  closeSync: (...args: unknown[]) => mocks.closeSync(...args),
  openSync: (...args: unknown[]) => mocks.openSync(...args),
}));

vi.mock('@shipfox/e2e-core', () => ({
  config: {API_URL: 'http://localhost:3000'},
  createApiClient: (...args: unknown[]) => mocks.createApiClient(...args),
  pollUntil: (...args: unknown[]) => mocks.pollUntil(...args),
}));

const {startProvisioner} = await import('./provisioner-process.js');

const WORKSPACE_ID = 'workspace-1';

function createChild() {
  const child = new EventEmitter() as ChildProcess & {kill: ReturnType<typeof vi.fn>};
  Object.assign(child, {kill: vi.fn(), pid: 1234});
  return child;
}

describe('startProvisioner installation readiness', () => {
  beforeEach(() => {
    mocks.closeSync.mockReset();
    mocks.createApiClient.mockReset();
    mocks.openSync.mockReset().mockReturnValue(1);
    mocks.pollUntil
      .mockReset()
      .mockImplementation((_options: unknown, probe: () => Promise<unknown>) => probe());
    mocks.requestJson.mockReset().mockImplementation((_method: string, path: string) => {
      if (path === `/admin/runners/workspaces/${WORKSPACE_ID}/capacity`) return {};
      if (path === '/provisioners/me') {
        return {
          id: 'provisioner-1',
          scope: 'workspace',
          workspace_id: WORKSPACE_ID,
        };
      }
      throw new Error(`Unexpected request path: ${path}`);
    });
    mocks.createApiClient.mockReturnValue({requestJson: mocks.requestJson});
  });

  it('starts an installation-scoped provisioner when readiness succeeds', async () => {
    const child = createChild();
    mocks.spawn.mockReset().mockReturnValue(child);
    mocks.requestJson.mockImplementation((_method: string, path: string) => {
      if (path === `/admin/runners/workspaces/${WORKSPACE_ID}/capacity`) return {};
      if (path === '/provisioners/me') {
        return {
          id: 'provisioner-installation-1',
          scope: 'installation',
        };
      }
      throw new Error(`Unexpected request path: ${path}`);
    });

    const handle = await startProvisioner({
      mode: 'source',
      scope: 'installation',
      workspaceId: WORKSPACE_ID,
      adminToken: 'admin-token',
      provisionerToken: 'provisioner-token',
      templatesFile: '/suite/templates.yaml',
      logFile: '/suite/provisioner.log',
      entryPath: '/suite/provisioner.ts',
    });

    expect(handle).toMatchObject({
      mode: 'source',
      pid: 1234,
      logFile: '/suite/provisioner.log',
      workspaceId: WORKSPACE_ID,
      provisioner: {
        id: 'provisioner-installation-1',
        name: null,
        prefix: 'installation',
        last_seen_at: expect.any(String),
      },
    });
    expect(mocks.requestJson).toHaveBeenNthCalledWith(
      1,
      'get',
      `/admin/runners/workspaces/${WORKSPACE_ID}/capacity`,
    );
    expect(mocks.requestJson).toHaveBeenNthCalledWith(2, 'get', '/provisioners/me');
    expect(mocks.spawn).toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects a workspace-scoped token for installation readiness', async () => {
    const child = createChild();
    mocks.spawn.mockReset().mockReturnValue(child);

    await expect(
      startProvisioner({
        mode: 'source',
        scope: 'installation',
        workspaceId: WORKSPACE_ID,
        adminToken: 'admin-token',
        provisionerToken: 'provisioner-token',
        templatesFile: '/suite/templates.yaml',
        logFile: '/suite/provisioner.log',
        entryPath: '/suite/provisioner.ts',
      }),
    ).rejects.toThrow(
      'Provisioner token scope mismatch: expected installation scope, received workspace scope.',
    );

    expect(mocks.requestJson).toHaveBeenNthCalledWith(
      1,
      'get',
      `/admin/runners/workspaces/${WORKSPACE_ID}/capacity`,
    );
    expect(mocks.requestJson).toHaveBeenNthCalledWith(2, 'get', '/provisioners/me');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
