import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pollUntil} from '@shipfox/e2e-core';

const execFileAsync = promisify(execFile);

const REGISTRY_IMAGE = 'registry:2';
const REGISTRY_PORT = '5000/tcp';
const REGISTRY_READY_TIMEOUT_MS = 30_000;
const DOCKER_TIMEOUT_MS = 300_000;
const DOCKER_MAX_BUFFER = 16 * 1024 * 1024;

export interface PublishJobContainerImageParams {
  /** Directory with the `Dockerfile` and its build context. */
  contextDir: string;
  /** Repository name of the image in the registry, such as `shipfox-e2e/toolbox`. */
  name: string;
  /** Makes the registry container name unique. */
  uniqueId: string;
}

export interface PublishedJobContainerImage {
  /** The reference a job `container` names. */
  image: string;
  registryContainer: string;
}

async function docker(args: string[]): Promise<string> {
  try {
    const {stdout} = await execFileAsync('docker', args, {
      timeout: DOCKER_TIMEOUT_MS,
      maxBuffer: DOCKER_MAX_BUFFER,
    });
    return stdout.trim();
  } catch (error) {
    const {stdout = '', stderr = ''} = error as {stdout?: string; stderr?: string};
    throw new Error(`docker ${args.join(' ')} failed.\n${stdout}\n${stderr}`, {cause: error});
  }
}

/**
 * Builds an image and pushes it to a registry started for it on a loopback port. The
 * runner always pulls the job image, so an image that only exists in the local Docker
 * image store is not enough. Docker accepts a loopback registry without TLS.
 */
export async function publishJobContainerImage(
  params: PublishJobContainerImageParams,
): Promise<PublishedJobContainerImage> {
  const registryContainer = `shipfox-e2e-registry-${params.uniqueId}`;
  await docker([
    'run',
    '--detach',
    '--name',
    registryContainer,
    '--publish',
    `127.0.0.1::${REGISTRY_PORT}`,
    REGISTRY_IMAGE,
  ]);
  try {
    const address = await docker(['port', registryContainer, REGISTRY_PORT]);
    const port = address.split('\n')[0]?.split(':').at(-1);
    if (!port) throw new Error(`The registry port is unknown: "${address}"`);
    const registry = `127.0.0.1:${port}`;
    await pollUntil(
      {
        timeoutMs: REGISTRY_READY_TIMEOUT_MS,
        intervalMs: 250,
        describe: () => `registry ${registry} to accept requests`,
      },
      async () => {
        const response = await fetch(`http://${registry}/v2/`).catch(() => undefined);
        return response?.ok === true ? true : null;
      },
    );

    const image = `${registry}/${params.name}:e2e`;
    await docker(['build', '--tag', image, params.contextDir]);
    await docker(['push', image]);
    return {image, registryContainer};
  } catch (error) {
    await removePublishedJobContainerImage({registryContainer});
    throw error;
  }
}

/** Best-effort: a Docker failure is written to stderr, not thrown. */
export async function removePublishedJobContainerImage(
  published: Pick<PublishedJobContainerImage, 'registryContainer'> & {image?: string | undefined},
): Promise<void> {
  const removals = [
    ['rm', '--force', '--volumes', published.registryContainer],
    ...(published.image === undefined ? [] : [['rmi', '--force', published.image]]),
  ];
  for (const args of removals) {
    await docker(args).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`e2e-driver-runner-process: ${message}\n`);
    });
  }
}
