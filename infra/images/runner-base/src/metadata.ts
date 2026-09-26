import {readFileSync} from 'node:fs';
import {Ajv2020, type ValidateFunction} from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';

const addFormats = addFormatsModule.default as unknown as (validator: Ajv2020) => void;

export const RUNNER_BASE_API_VERSION = 'shipfox.runner-base/v1';
export const RUNNER_BASE_IMAGE_OS = 'ubuntu24';
export const RUNNER_BASE_LIFECYCLE = 'runner-base';
export const RUNNER_BASE_POINTER_PARAMETER = '/shipfox/runner-base/ubuntu24/current';
export const RUNNER_BASE_REGION = 'eu-central-1';

// The Packer template writes the same tags; keep locals.pkr.hcl aligned.
export const RUNNER_BASE_TAGS = {
  architecture: 'shipfox.architecture',
  generation: 'shipfox.base_generation',
  imageOs: 'shipfox.image_os',
  lifecycle: 'shipfox.lifecycle',
  managed: 'shipfox.managed',
  recipe: 'shipfox.base_recipe',
  revision: 'shipfox.revision',
  status: 'shipfox.base_status',
} as const;

export type RunnerBaseArchitecture = 'amd64' | 'arm64';
export type RunnerBaseStatus = 'building' | 'verified';

export interface RunnerBaseImage {
  architecture: RunnerBaseArchitecture;
  amiId: string;
  sourceAmiId: string;
  createdAt: string;
}

export interface RunnerBaseMetadata {
  apiVersion: typeof RUNNER_BASE_API_VERSION;
  generation: string;
  recipeDigest: string;
  sourceRevision: string;
  buildUrl: string;
  createdAt: string;
  verifiedAt: string;
  owner: string;
  region: string;
  kmsKeyArn: string;
  imageOs: typeof RUNNER_BASE_IMAGE_OS;
  images: RunnerBaseImage[];
}

export interface RunnerBaseImageTagOptions {
  architecture: RunnerBaseArchitecture;
  generation: string;
  recipeDigest: string;
  revision: string;
  status: RunnerBaseStatus;
}

export function runnerBaseImageTags(options: RunnerBaseImageTagOptions): Record<string, string> {
  return {
    [RUNNER_BASE_TAGS.managed]: 'true',
    [RUNNER_BASE_TAGS.lifecycle]: RUNNER_BASE_LIFECYCLE,
    [RUNNER_BASE_TAGS.imageOs]: RUNNER_BASE_IMAGE_OS,
    [RUNNER_BASE_TAGS.architecture]: options.architecture,
    [RUNNER_BASE_TAGS.generation]: options.generation,
    [RUNNER_BASE_TAGS.recipe]: options.recipeDigest,
    [RUNNER_BASE_TAGS.revision]: options.revision,
    [RUNNER_BASE_TAGS.status]: options.status,
  };
}

let validator: ValidateFunction<RunnerBaseMetadata> | undefined;

export function parseRunnerBaseMetadata(value: unknown): RunnerBaseMetadata {
  validator ??= createMetadataValidator();
  if (!validator(value)) {
    const errors = (validator.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ');
    throw new Error(`Runner base metadata is invalid: ${errors}`);
  }

  // The key must be the account's own key in the base region: an alias or a foreign key would
  // break the snapshot lineage that derived candidates rely on.
  const [, , , keyRegion, keyOwner] = value.kmsKeyArn.split(':');
  if (keyRegion !== value.region || keyOwner !== value.owner) {
    throw new Error('Runner base metadata kmsKeyArn must belong to its owner and region.');
  }
  for (const image of value.images) {
    if (Date.parse(image.createdAt) > Date.parse(value.verifiedAt)) {
      throw new Error(`Runner base ${image.architecture} image was created after verification.`);
    }
  }
  return value;
}

function createMetadataValidator(): ValidateFunction<RunnerBaseMetadata> {
  const schemaPath = new URL('../schema/runner-base.v1.schema.json', import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({allErrors: true, strict: true});
  addFormats(ajv);
  return ajv.compile<RunnerBaseMetadata>(schema);
}
