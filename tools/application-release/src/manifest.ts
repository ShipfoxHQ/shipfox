import {readFileSync} from 'node:fs';
import Ajv2020, {type ValidateFunction} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type {ApplicationReleasePackage} from './package-closure.js';

export const APPLICATION_RELEASE_KIND = 'shipfox.application-release';
export const APPLICATION_RELEASE_API_VERSION = 'v1';
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/;

/**
 * Required v1 components. Keeping this list explicit prevents a newly published
 * image from entering a release without an application-release schema change.
 */
export const APPLICATION_RELEASE_IMAGES = {
  api: 'ghcr.io/shipfoxhq/api',
  client: 'ghcr.io/shipfoxhq/client',
  provisioner: 'ghcr.io/shipfoxhq/provisioner-docker',
  runner: 'ghcr.io/shipfoxhq/runner',
} as const;

export type ApplicationImageName = keyof typeof APPLICATION_RELEASE_IMAGES;

export interface UnpublishedAttestation {
  status: 'not-published';
}

export interface PublishedAttestation {
  status: 'available';
  reference: string;
}

export type Attestation = UnpublishedAttestation | PublishedAttestation;

export interface ApplicationImage {
  repository: string;
  digest: string;
  platforms: string[];
  attestations: {
    provenance: Attestation;
    sbom: Attestation;
  };
}

export type ApplicationImageSet = Record<ApplicationImageName, ApplicationImage>;

export interface ApplicationReleaseInput {
  sourceRepository: string;
  revision: string;
  build: {
    system: string;
    id: string;
    number: number;
    attempt: number;
    startedAt: string;
    url: string;
  };
  publishedAt: string;
  images: ApplicationImageSet;
  packages: ApplicationReleasePackage[];
}

export interface ApplicationReleaseManifest {
  kind: typeof APPLICATION_RELEASE_KIND;
  apiVersion: typeof APPLICATION_RELEASE_API_VERSION;
  source: {
    repository: string;
    revision: string;
  };
  build: ApplicationReleaseInput['build'];
  publishedAt: string;
  images: ApplicationImageSet;
  packages: ApplicationReleasePackage[];
}

const validateManifest = createManifestValidator();

export function createApplicationReleaseManifest(
  input: ApplicationReleaseInput,
): ApplicationReleaseManifest {
  const manifest: ApplicationReleaseManifest = {
    kind: APPLICATION_RELEASE_KIND,
    apiVersion: APPLICATION_RELEASE_API_VERSION,
    source: {
      repository: input.sourceRepository,
      revision: input.revision,
    },
    build: {
      ...input.build,
      startedAt: timestamp(input.build.startedAt, 'Build start time'),
    },
    publishedAt: timestamp(input.publishedAt, 'Publication time'),
    images: input.images,
    packages: input.packages,
  };

  if (!validateManifest(manifest)) {
    throw new Error(`Invalid application release manifest: ${formatErrors(validateManifest)}`);
  }

  return manifest;
}

function createManifestValidator(): ValidateFunction<ApplicationReleaseManifest> {
  const schemaPath = new URL('../schema/v1.schema.json', import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validator = new Ajv2020({allErrors: true, strict: true});
  addFormats(validator);
  return validator.compile<ApplicationReleaseManifest>(schema);
}

function timestamp(value: string, label: string): string {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid UTC timestamp`);
  }

  const canonicalValue = value.includes('.') ? value : `${value.slice(0, -1)}.000Z`;
  const parsed = new Date(value);
  const isValid = !Number.isNaN(parsed.getTime()) && parsed.toISOString() === canonicalValue;

  if (!isValid) throw new Error(`${label} must be a valid UTC timestamp`);
  return canonicalValue;
}

function formatErrors(validator: ValidateFunction): string {
  return (
    validator.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ') ?? 'unknown schema error'
  );
}
