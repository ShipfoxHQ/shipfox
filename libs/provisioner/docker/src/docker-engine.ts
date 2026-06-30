import Docker from 'dockerode';
import {SHIPFOX_LABELS} from '#container-identity.js';

const LEADING_SLASH = /^\//;

export type DockerEngineErrorReason =
  | 'daemon-unreachable'
  | 'image-not-found'
  | 'name-conflict'
  | 'create-failed'
  | 'start-failed'
  | 'not-found'
  | 'unknown';

export class DockerEngineError extends Error {
  constructor(
    public readonly reason: DockerEngineErrorReason,
    message: string,
    options?: {cause?: unknown},
  ) {
    super(message, options);
    this.name = 'DockerEngineError';
  }
}

export type DockerContainerState =
  | 'created'
  | 'running'
  | 'exited'
  | 'dead'
  | 'removing'
  | 'paused'
  | 'restarting'
  | 'unknown';

export interface DockerContainerView {
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly state: DockerContainerState;
  readonly exitCode?: number;
  readonly oomKilled?: boolean;
  readonly createdAt: Date;
}

export interface DockerEngine {
  ensureImage(image: string): Promise<void>;
  createAndStart(args: {
    name: string;
    image: string;
    env: Readonly<Record<string, string>>;
    labels: Readonly<Record<string, string>>;
    nanoCpus: number;
    memoryBytes: number;
  }): Promise<void>;
  listManaged(provisionerId: string): Promise<DockerContainerView[]>;
  remove(name: string): Promise<void>;
  killAndRemove(name: string): Promise<void>;
}

export interface CreateDockerEngineOptions {
  readonly host?: string;
  readonly network?: string;
  readonly docker?: Docker;
}

export function createDockerEngine(options: CreateDockerEngineOptions = {}): DockerEngine {
  const docker = options.docker ?? new Docker(dockerOptionsForHost(options.host));

  return {
    async ensureImage(image) {
      try {
        await docker.getImage(image).inspect();
        return;
      } catch (error) {
        if (!isNotFound(error))
          throw mapError(error, 'image-not-found', `Cannot inspect image ${image}.`);
      }

      try {
        const stream = await docker.pull(image);
        await followProgress(docker, stream);
      } catch (error) {
        throw mapError(error, 'image-not-found', `Cannot pull image ${image}.`);
      }

      try {
        await docker.getImage(image).inspect();
      } catch (error) {
        if (isNotFound(error)) {
          throw new DockerEngineError(
            'image-not-found',
            `Image ${image} is not available after pull.`,
            {
              cause: error,
            },
          );
        }
        throw mapError(error, 'image-not-found', `Image ${image} is not available after pull.`);
      }
    },

    async createAndStart(args) {
      await this.ensureImage(args.image);
      let container: Docker.Container | undefined;

      try {
        container = await docker.createContainer({
          Image: args.image,
          name: args.name,
          Labels: {...args.labels},
          Env: Object.entries(args.env).map(([key, value]) => `${key}=${value}`),
          HostConfig: {
            NanoCpus: args.nanoCpus,
            Memory: args.memoryBytes,
            RestartPolicy: {Name: 'no'},
            ...(options.network ? {NetworkMode: options.network} : {}),
          },
        });
      } catch (error) {
        throw mapError(
          error,
          isConflict(error) ? 'name-conflict' : 'create-failed',
          'Cannot create runner container.',
        );
      }

      try {
        await container.start();
      } catch (error) {
        await removeContainer(container).catch(() => undefined);
        throw mapError(error, 'start-failed', 'Cannot start runner container.');
      }
    },

    async listManaged(provisionerId) {
      try {
        const containers = await docker.listContainers({
          all: true,
          filters: {label: [`${SHIPFOX_LABELS.provisionerId}=${provisionerId}`]},
        });

        return Promise.all(
          containers.map(async (container) => {
            const state = normalizeState(container.State);
            const inspected = state === 'exited' ? await inspectContainer(container.Id) : undefined;
            return {
              id: container.Id,
              name: container.Names?.[0]?.replace(LEADING_SLASH, '') ?? container.Id,
              labels: container.Labels ?? {},
              state,
              ...(inspected?.State?.ExitCode !== undefined
                ? {exitCode: inspected.State.ExitCode}
                : {}),
              ...(inspected?.State?.OOMKilled !== undefined
                ? {oomKilled: inspected.State.OOMKilled}
                : {}),
              createdAt: new Date(container.Created * 1000),
            };
          }),
        );
      } catch (error) {
        throw mapError(error, 'unknown', 'Cannot list managed Docker containers.');
      }
    },

    async remove(name) {
      try {
        await docker.getContainer(name).remove({force: true});
      } catch (error) {
        if (isNotFound(error)) return;
        throw mapError(error, 'unknown', `Cannot remove Docker container ${name}.`);
      }
    },

    async killAndRemove(name) {
      const container = docker.getContainer(name);
      try {
        await container.kill();
      } catch (error) {
        if (!isNotFound(error) && !isConflict(error)) {
          throw mapError(error, 'unknown', `Cannot kill Docker container ${name}.`);
        }
      }

      try {
        await container.remove({force: true});
      } catch (error) {
        if (isNotFound(error)) return;
        throw mapError(error, 'unknown', `Cannot remove Docker container ${name}.`);
      }
    },
  };

  async function inspectContainer(id: string): Promise<Docker.ContainerInspectInfo | undefined> {
    try {
      return await docker.getContainer(id).inspect();
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

async function followProgress(docker: Docker, stream: NodeJS.ReadableStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (error: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function removeContainer(container: Docker.Container): Promise<void> {
  await container.remove({force: true});
}

function normalizeState(state: string | undefined): DockerContainerState {
  switch (state) {
    case 'created':
    case 'running':
    case 'exited':
    case 'dead':
    case 'removing':
    case 'paused':
    case 'restarting':
      return state;
    default:
      return 'unknown';
  }
}

function mapError(
  error: unknown,
  fallback: DockerEngineErrorReason,
  message: string,
): DockerEngineError {
  if (error instanceof DockerEngineError) return error;
  if (isConnectionError(error))
    return new DockerEngineError('daemon-unreachable', message, {cause: error});
  if (isNotFound(error))
    return new DockerEngineError(fallback === 'image-not-found' ? fallback : 'not-found', message, {
      cause: error,
    });
  if (isConflict(error)) return new DockerEngineError('name-conflict', message, {cause: error});
  return new DockerEngineError(fallback, message, {cause: error});
}

export function dockerOptionsForHost(host: string | undefined): Docker.DockerOptions {
  if (!host) return {};
  if (host.startsWith('unix://')) return {socketPath: new URL(host).pathname};

  try {
    const url = new URL(host);
    if (url.protocol === 'tcp:' || url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        protocol: url.protocol === 'https:' ? 'https' : 'http',
        host: url.hostname,
        ...(url.port ? {port: Number(url.port)} : {}),
      };
    }
    if (url.protocol === 'ssh:') {
      return {
        protocol: 'ssh',
        host: url.hostname,
        ...(url.port ? {port: Number(url.port)} : {}),
      };
    }
  } catch {
    return {host};
  }

  return {host};
}

function isConnectionError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    ['ECONNREFUSED', 'ENOENT', 'EACCES', 'EPIPE', 'ECONNRESET'].includes(String(error.code))
  );
}

function isNotFound(error: unknown): boolean {
  return hasStatusCode(error, 404);
}

function isConflict(error: unknown): boolean {
  return hasStatusCode(error, 409);
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as {statusCode?: unknown}).statusCode === statusCode
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
