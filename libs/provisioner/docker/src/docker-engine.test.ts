import {Readable} from 'node:stream';
import {createDockerEngine} from '#docker-engine.js';

describe('createDockerEngine', () => {
  it('pulls an image when absent and skips pull when present', async () => {
    const docker = fakeDocker({missingImages: new Set(['runner:missing'])});
    const engine = createDockerEngine({docker: docker as never});

    await engine.ensureImage('runner:present');
    await engine.ensureImage('runner:missing');

    expect(docker.pulled).toEqual(['runner:missing']);
  });

  it('creates and starts a container with Docker resource limits', async () => {
    const docker = fakeDocker();
    const engine = createDockerEngine({docker: docker as never, network: 'shipfox'});

    await engine.createAndStart({
      name: 'runner-1',
      image: 'runner:latest',
      env: {A: '1'},
      labels: {'shipfox.provisioner_id': 'p1'},
      nanoCpus: 1_000_000_000,
      memoryBytes: 1024,
    });

    expect(docker.created[0]).toMatchObject({
      Image: 'runner:latest',
      name: 'runner-1',
      Env: ['A=1'],
      HostConfig: {
        NanoCpus: 1_000_000_000,
        Memory: 1024,
        RestartPolicy: {Name: 'no'},
        NetworkMode: 'shipfox',
      },
    });
    expect(docker.started).toEqual(['runner-1']);
  });

  it('removes a created container when start fails', async () => {
    const docker = fakeDocker({startError: new Error('start failed')});
    const engine = createDockerEngine({docker: docker as never});

    await expect(
      engine.createAndStart({
        name: 'runner-1',
        image: 'runner:latest',
        env: {},
        labels: {'shipfox.provisioner_id': 'p1'},
        nanoCpus: 1,
        memoryBytes: 1,
      }),
    ).rejects.toMatchObject({reason: 'start-failed'});

    expect(docker.removed).toEqual(['runner-1']);
  });

  it('maps create conflicts to name-conflict', async () => {
    const docker = fakeDocker({createError: statusError(409)});
    const engine = createDockerEngine({docker: docker as never});

    await expect(
      engine.createAndStart({
        name: 'runner-1',
        image: 'runner:latest',
        env: {},
        labels: {'shipfox.provisioner_id': 'p1'},
        nanoCpus: 1,
        memoryBytes: 1,
      }),
    ).rejects.toMatchObject({reason: 'name-conflict'});
  });

  it('maps connection errors to daemon-unreachable', async () => {
    const error = new Error('connect') as NodeJS.ErrnoException;
    error.code = 'ECONNREFUSED';
    const docker = fakeDocker({listError: error});
    const engine = createDockerEngine({docker: docker as never});

    await expect(engine.listManaged('p1')).rejects.toMatchObject({
      reason: 'daemon-unreachable',
    });
  });

  it('inspects exited containers for exit code and OOM status', async () => {
    const docker = fakeDocker({
      containers: [
        {
          Id: 'id1',
          Names: ['/runner-1'],
          Labels: {'shipfox.provisioner_id': 'p1'},
          State: 'exited',
          Created: 1,
        },
      ],
      inspectById: new Map([['id1', {State: {ExitCode: 137, OOMKilled: true}}]]),
    });
    const engine = createDockerEngine({docker: docker as never});

    const result = await engine.listManaged('p1');

    expect(result[0]).toMatchObject({
      id: 'id1',
      name: 'runner-1',
      state: 'exited',
      exitCode: 137,
      oomKilled: true,
    });
  });

  it('keeps listed exited containers when inspect races with removal', async () => {
    const docker = fakeDocker({
      containers: [
        {
          Id: 'id1',
          Names: ['/runner-1'],
          Labels: {'shipfox.provisioner_id': 'p1'},
          State: 'exited',
          Created: 1,
        },
      ],
      inspectErrorById: new Map([['id1', statusError(404)]]),
    });
    const engine = createDockerEngine({docker: docker as never});

    const result = await engine.listManaged('p1');

    expect(result).toEqual([
      {
        id: 'id1',
        name: 'runner-1',
        labels: {'shipfox.provisioner_id': 'p1'},
        state: 'exited',
        createdAt: new Date(1000),
      },
    ]);
  });

  it('removes containers when kill reports not running', async () => {
    const docker = fakeDocker({killErrorById: new Map([['runner-1', statusError(409)]])});
    const engine = createDockerEngine({docker: docker as never});

    await engine.killAndRemove('runner-1');

    expect(docker.removed).toEqual(['runner-1']);
  });
});

function fakeDocker(
  options: {
    missingImages?: Set<string>;
    createError?: Error;
    startError?: Error;
    listError?: Error;
    containers?: unknown[];
    inspectById?: Map<string, unknown>;
    inspectErrorById?: Map<string, Error>;
    killErrorById?: Map<string, Error>;
  } = {},
) {
  const pulled: string[] = [];
  const created: unknown[] = [];
  const started: string[] = [];
  const removed: string[] = [];
  const missingImages = options.missingImages ?? new Set<string>();

  return {
    pulled,
    created,
    started,
    removed,
    modem: {
      followProgress: (_stream: NodeJS.ReadableStream, callback: (error: Error | null) => void) =>
        callback(null),
    },
    getImage: (image: string) => ({
      inspect: () => {
        if (missingImages.has(image)) {
          missingImages.delete(image);
          return Promise.reject(statusError(404));
        }
        return Promise.resolve({});
      },
    }),
    pull: (image: string) => {
      pulled.push(image);
      return Promise.resolve(Readable.from([]));
    },
    createContainer: (params: unknown) => {
      if (options.createError) return Promise.reject(options.createError);
      created.push(params);
      const name = (params as {name: string}).name;
      return Promise.resolve({
        start: () => {
          if (options.startError) return Promise.reject(options.startError);
          started.push(name);
          return Promise.resolve();
        },
        remove: () => {
          removed.push(name);
          return Promise.resolve();
        },
      });
    },
    listContainers: () => {
      if (options.listError) return Promise.reject(options.listError);
      return Promise.resolve(options.containers ?? []);
    },
    getContainer: (id: string) => ({
      inspect: () => {
        const inspectError = options.inspectErrorById?.get(id);
        if (inspectError) return Promise.reject(inspectError);
        return Promise.resolve(options.inspectById?.get(id) ?? {});
      },
      remove: () => {
        removed.push(id);
        return Promise.resolve();
      },
      kill: () => {
        const killError = options.killErrorById?.get(id);
        if (killError) return Promise.reject(killError);
        return Promise.resolve();
      },
    }),
  };
}

function statusError(statusCode: number): Error & {statusCode: number} {
  const error = new Error('docker error') as Error & {statusCode: number};
  error.statusCode = statusCode;
  return error;
}
