import {Readable} from 'node:stream';
import {createDockerEngine, DockerEngineError} from '#docker-engine.js';

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
});

function fakeDocker(
  options: {
    missingImages?: Set<string>;
    startError?: Error;
    listError?: Error;
    containers?: unknown[];
    inspectById?: Map<string, unknown>;
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
      inspect: () => Promise.resolve(options.inspectById?.get(id) ?? {}),
      remove: () => {
        removed.push(id);
        return Promise.resolve();
      },
      kill: () => Promise.resolve(),
    }),
  };
}

function statusError(statusCode: number): DockerEngineError & {statusCode: number} {
  const error = new DockerEngineError('unknown', 'docker error') as DockerEngineError & {
    statusCode: number;
  };
  error.statusCode = statusCode;
  return error;
}
