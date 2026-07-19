import {readFileSync} from 'node:fs';

const AMI_ID_PATTERN = /ami-[0-9a-f]{17}\b/gi;
const AMI_ARTIFACT_ID_PATTERN = /^([a-z]{2}(?:-gov)?-[a-z]+-\d):((?:ami)-[0-9a-f]{17})$/u;

export interface PackerAmiArtifact {
  amiId: string;
  region: string;
  buildTime: number;
  customData: Record<string, string>;
}

export function findProducedAmiId(output: string): string | null {
  return [...output.matchAll(AMI_ID_PATTERN)].at(-1)?.[0] ?? null;
}

export function readPackerAmiArtifact(path: string): PackerAmiArtifact {
  return parsePackerAmiArtifact(JSON.parse(readFileSync(path, 'utf8')));
}

export function parsePackerAmiArtifact(value: unknown): PackerAmiArtifact {
  const manifest = object(value, 'Packer manifest');
  const lastRunUuid = string(manifest.last_run_uuid, 'Packer manifest last_run_uuid');
  const builds = array(manifest.builds, 'Packer manifest builds');
  const build = builds
    .map((item) => object(item, 'Packer manifest build'))
    .find(
      (item) =>
        item.packer_run_uuid === lastRunUuid &&
        item.builder_type === 'amazon-ebs' &&
        item.name === 'build_image',
    );

  if (!build) throw new Error('Packer manifest does not include the completed runner AMI build.');

  const artifactId = string(build.artifact_id, 'Packer manifest artifact_id');
  const artifact = AMI_ARTIFACT_ID_PATTERN.exec(artifactId);
  if (!artifact) throw new Error(`Packer manifest has an invalid AMI artifact ID: ${artifactId}`);
  const [, region, amiId] = artifact;
  if (!region || !amiId)
    throw new Error(`Packer manifest has an invalid AMI artifact ID: ${artifactId}`);

  return {
    region,
    amiId,
    buildTime: number(build.build_time, 'Packer manifest build_time'),
    customData: stringRecord(build.custom_data, 'Packer manifest custom_data'),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  const record = object(value, label);
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string') throw new Error(`${label}.${key} must be a string.`);
  }
  return record as Record<string, string>;
}
