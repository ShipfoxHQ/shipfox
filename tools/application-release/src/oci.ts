import {execFileSync} from 'node:child_process';
import {
  APPLICATION_RELEASE_IMAGES,
  type ApplicationImage,
  type ApplicationImageSet,
} from './manifest.js';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

interface OciDescriptor {
  digest?: string;
}

interface OciManifest {
  config?: OciDescriptor;
  manifests?: Array<
    OciDescriptor & {
      platform?: {
        os?: string;
        architecture?: string;
        variant?: string;
      };
    }
  >;
}

interface OciImageConfig {
  config?: {
    Labels?: Record<string, string>;
  };
}

export interface OciRegistry {
  fetchDescriptor(reference: string): OciDescriptor;
  fetchManifest(reference: string): OciManifest;
  fetchBlob(reference: string): OciImageConfig;
}

export function resolveApplicationImages(
  tag: string,
  revision: string,
  registry: OciRegistry = orasRegistry(),
  imageRevision = revision,
): ApplicationImageSet {
  return {
    api: resolveImage(APPLICATION_RELEASE_IMAGES.api, tag, revision, registry, imageRevision),
    client: resolveImage(APPLICATION_RELEASE_IMAGES.client, tag, revision, registry, imageRevision),
    provisioner: resolveImage(
      APPLICATION_RELEASE_IMAGES.provisioner,
      tag,
      revision,
      registry,
      imageRevision,
    ),
    runner: resolveImage(APPLICATION_RELEASE_IMAGES.runner, tag, revision, registry, imageRevision),
  };
}

export function resolveImage(
  repository: string,
  tag: string,
  revision: string,
  registry: OciRegistry,
  imageRevision = revision,
): ApplicationImage {
  const taggedReference = `${repository}:${tag}`;
  const descriptor = registry.fetchDescriptor(taggedReference);
  const digest = assertDigest(descriptor.digest, `Digest for ${taggedReference}`);
  const manifest = registry.fetchManifest(`${repository}@${digest}`);
  const platformDescriptors = manifest.manifests?.filter(hasRunnablePlatform);

  if (!platformDescriptors?.length) {
    throw new Error(`${taggedReference} must be a multi-platform OCI image index`);
  }

  const platforms = platformDescriptors.map((platformDescriptor) => {
    const platformDigest = assertDigest(
      platformDescriptor.digest,
      `Platform manifest digest for ${taggedReference}`,
    );
    const platformManifest = registry.fetchManifest(`${repository}@${platformDigest}`);
    const configDigest = assertDigest(
      platformManifest.config?.digest,
      `Config digest for ${taggedReference}`,
    );
    const config = registry.fetchBlob(`${repository}@${configDigest}`);
    const actualRevision = config.config?.Labels?.['org.opencontainers.image.revision'];
    const platform = platformName(platformDescriptor.platform);

    if (actualRevision !== imageRevision) {
      throw new Error(
        `${taggedReference} (${platform}) has OCI revision ${JSON.stringify(actualRevision)}; expected ${imageRevision}`,
      );
    }

    return platform;
  });

  if (new Set(platforms).size !== platforms.length) {
    throw new Error(`${taggedReference} contains a duplicate OCI platform`);
  }

  return {
    repository,
    digest,
    platforms,
    attestations: {
      provenance: {status: 'not-published'},
      sbom: {status: 'not-published'},
    },
  };
}

function orasRegistry(): OciRegistry {
  return {
    fetchDescriptor(reference) {
      return orasJson(['manifest', 'fetch', '--descriptor', reference]);
    },
    fetchManifest(reference) {
      return orasJson(['manifest', 'fetch', reference]);
    },
    fetchBlob(reference) {
      return orasJson(['blob', 'fetch', '--output', '-', reference]);
    },
  };
}

function orasJson<T>(args: string[]): T {
  let output: string;
  try {
    output = execFileSync('oras', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(`oras ${args.slice(0, 2).join(' ')} failed${detail ? `: ${detail}` : ''}`, {
      cause: error,
    });
  }

  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new Error(`oras ${args.slice(0, 2).join(' ')} returned invalid JSON`, {cause: error});
  }
}

function hasRunnablePlatform(descriptor: NonNullable<OciManifest['manifests']>[number]): boolean {
  return Boolean(
    descriptor.platform?.os &&
      descriptor.platform.architecture &&
      descriptor.platform.os !== 'unknown' &&
      descriptor.platform.architecture !== 'unknown',
  );
}

function platformName(platform: NonNullable<OciManifest['manifests']>[number]['platform']): string {
  const parts = [platform?.os, platform?.architecture, platform?.variant].filter(Boolean);
  if (parts.length < 2)
    throw new Error('OCI platform must include an operating system and architecture');
  return parts.join('/');
}

function assertDigest(value: string | undefined, label: string): string {
  if (!DIGEST_PATTERN.test(value ?? '')) throw new Error(`${label} must be a sha256 digest`);
  return value as string;
}
