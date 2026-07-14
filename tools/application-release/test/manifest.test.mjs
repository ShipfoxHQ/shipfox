import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, test} from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import {
  APPLICATION_RELEASE_API_VERSION,
  APPLICATION_RELEASE_KIND,
  createApplicationReleaseManifest,
} from '../dist/manifest.js';

const revision = '0123456789abcdef0123456789abcdef01234567';
const digest = (character) => `sha256:${character.repeat(64)}`;
const schema = JSON.parse(
  readFileSync(new URL('../schema/v1.schema.json', import.meta.url), 'utf8'),
);
const schemaValidator = new Ajv2020({strict: true});
addFormats(schemaValidator);
const validateManifest = schemaValidator.compile(schema);
const portableSchemaValidator = new Ajv2020({strict: true, validateFormats: false});
const validatePortableManifest = portableSchemaValidator.compile(schema);
const invalidBuildTimestampError = /Build start time must be a valid UTC timestamp/;

function image(repository, character) {
  return {
    repository,
    digest: digest(character),
    platforms: ['linux/amd64', 'linux/arm64'],
    attestations: {
      provenance: {status: 'not-published'},
      sbom: {status: 'not-published'},
    },
  };
}

function input() {
  return {
    sourceRepository: 'https://github.com/ShipfoxHQ/shipfox',
    revision,
    build: {
      system: 'github-actions',
      id: '123456789',
      number: 42,
      attempt: 2,
      startedAt: '2026-07-13T15:30:00Z',
      url: 'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
    },
    publishedAt: '2026-07-13T16:00:00Z',
    images: {
      api: image('ghcr.io/shipfoxhq/api', 'a'),
      client: image('ghcr.io/shipfoxhq/client', 'b'),
      provisioner: image('ghcr.io/shipfoxhq/provisioner-docker', 'c'),
      runner: image('ghcr.io/shipfoxhq/runner', 'd'),
    },
  };
}

describe('createApplicationReleaseManifest', () => {
  test('creates a provider-neutral application release contract', () => {
    const manifest = createApplicationReleaseManifest(input());

    assert.equal(manifest.kind, APPLICATION_RELEASE_KIND);
    assert.equal(manifest.apiVersion, APPLICATION_RELEASE_API_VERSION);
    assert.equal(manifest.source.revision, revision);
    assert.equal(manifest.build.startedAt, '2026-07-13T15:30:00.000Z');
    assert.equal(manifest.publishedAt, '2026-07-13T16:00:00.000Z');
    assert.deepEqual(manifest.compatibility, {
      api: {logStorage: {s3CredentialModes: ['explicit', 'ambient']}},
    });
    assert.equal('publication' in manifest, false);
  });

  test('matches the strict version 1 schema', () => {
    const manifest = createApplicationReleaseManifest(input());

    const valid = validateManifest(manifest);

    assert.equal(valid, true, JSON.stringify(validateManifest.errors));
  });

  test('schema rejects an incomplete image set', () => {
    const manifest = createApplicationReleaseManifest(input());
    delete manifest.images.runner;

    const valid = validateManifest(manifest);

    assert.equal(valid, false);
  });

  test('schema rejects deployment-provider data', () => {
    const manifest = createApplicationReleaseManifest(input());
    manifest.deployment = {provider: 'example-cloud'};

    const valid = validateManifest(manifest);

    assert.equal(valid, false);
  });

  test('schema requires ambient S3 credential compatibility', () => {
    const manifest = createApplicationReleaseManifest(input());
    manifest.compatibility.api.logStorage.s3CredentialModes = ['explicit'];

    const valid = validateManifest(manifest);

    assert.equal(valid, false);
  });

  test('rejects a calendar date that JavaScript would normalize', () => {
    const releaseInput = input();
    releaseInput.build.startedAt = '2024-02-30T15:30:00Z';

    const create = () => createApplicationReleaseManifest(releaseInput);

    assert.throws(create, invalidBuildTimestampError);
  });

  test('accepts a valid leap-day timestamp', () => {
    const releaseInput = input();
    releaseInput.publishedAt = '2024-02-29T16:00:00Z';

    const manifest = createApplicationReleaseManifest(releaseInput);

    assert.equal(manifest.publishedAt, '2024-02-29T16:00:00.000Z');
  });

  test('schema rejects malformed timestamps without format assertions', () => {
    const manifest = createApplicationReleaseManifest(input());
    manifest.publishedAt = '2023-02-29T16:00:00.000Z';

    const valid = validatePortableManifest(manifest);

    assert.equal(valid, false);
  });

  test('schema rejects malformed URIs without format assertions', () => {
    const manifest = createApplicationReleaseManifest(input());
    manifest.build.url = 'https:not-a-hierarchical-url';

    const valid = validatePortableManifest(manifest);

    assert.equal(valid, false);
  });
});
