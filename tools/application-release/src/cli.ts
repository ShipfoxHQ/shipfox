import {writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {createApplicationReleaseManifest} from './manifest.js';
import {resolveApplicationImages} from './oci.js';
import {
  createApplicationReleasePackages,
  readPublicationClosureConfig,
  readWorkspacePackages,
} from './package-closure.js';

const POSITIVE_DECIMAL_PATTERN = /^[1-9]\d*$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;

export interface CreateOptions {
  sourceRepository: string;
  revision: string;
  buildSystem: string;
  buildId: string;
  buildNumber: number;
  buildAttempt: number;
  buildStartedAt: string;
  buildUrl: string;
  imageTag: string;
  reuseFromRevision?: string;
  output: string;
  publicationConfig: string;
}

export function parseCreateOptions(args: string[]): CreateOptions {
  const {positionals, values} = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      'source-repository': {type: 'string'},
      revision: {type: 'string'},
      'build-system': {type: 'string'},
      'build-id': {type: 'string'},
      'build-number': {type: 'string'},
      'build-attempt': {type: 'string'},
      'build-started-at': {type: 'string'},
      'build-url': {type: 'string'},
      'image-tag': {type: 'string'},
      'reuse-from-revision': {type: 'string'},
      output: {type: 'string'},
      'publication-config': {type: 'string'},
    },
  });

  if (positionals.length !== 1 || positionals[0] !== 'create') {
    throw new Error('Usage: shipfox-application-release create [options]');
  }

  const reuseFromRevision = values['reuse-from-revision'];
  if (reuseFromRevision && !REVISION_PATTERN.test(reuseFromRevision)) {
    throw new Error('--reuse-from-revision must be a 40-character lowercase Git revision');
  }

  return {
    sourceRepository: required(values['source-repository'], '--source-repository'),
    revision: required(values.revision, '--revision'),
    buildSystem: required(values['build-system'], '--build-system'),
    buildId: required(values['build-id'], '--build-id'),
    buildNumber: positiveInteger(required(values['build-number'], '--build-number')),
    buildAttempt: positiveInteger(required(values['build-attempt'], '--build-attempt')),
    buildStartedAt: required(values['build-started-at'], '--build-started-at'),
    buildUrl: required(values['build-url'], '--build-url'),
    imageTag: required(values['image-tag'], '--image-tag'),
    reuseFromRevision,
    output: required(values.output, '--output'),
    publicationConfig: values['publication-config'] ?? 'publication-closure.json',
  };
}

export function createApplicationRelease(options: CreateOptions): void {
  const images = resolveApplicationImages(
    options.imageTag,
    options.revision,
    undefined,
    options.reuseFromRevision,
  );
  const publicationConfigPath = resolve(options.publicationConfig);
  const repositoryRoot = dirname(publicationConfigPath);
  const packages = createApplicationReleasePackages(
    readWorkspacePackages(repositoryRoot),
    readPublicationClosureConfig(publicationConfigPath),
    repositoryRoot,
  );
  const manifest = createApplicationReleaseManifest({
    sourceRepository: options.sourceRepository,
    revision: options.revision,
    build: {
      system: options.buildSystem,
      id: options.buildId,
      number: options.buildNumber,
      attempt: options.buildAttempt,
      startedAt: options.buildStartedAt,
      url: options.buildUrl,
    },
    publishedAt: new Date().toISOString(),
    images,
    packages,
    ...(options.reuseFromRevision
      ? {
          artifactReuse: {
            fromRevision: options.reuseFromRevision,
            reason: 'version-only-main-commit' as const,
          },
        }
      : {}),
  });

  writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function runApplicationReleaseCli(args: string[]): void {
  createApplicationRelease(parseCreateOptions(args));
}

function required(value: string | undefined, option: string): string {
  if (!value) throw new Error(`${option} is required`);
  return value;
}

function positiveInteger(value: string): number {
  if (!POSITIVE_DECIMAL_PATTERN.test(value)) {
    throw new Error(`${JSON.stringify(value)} must be a positive decimal integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${JSON.stringify(value)} must be a safe positive decimal integer`);
  }
  return parsed;
}
