import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {resolveApplicationImages} from '../dist/oci.js';

const revision = '0123456789abcdef0123456789abcdef01234567';
const digest = (character) => `sha256:${character.repeat(64)}`;
const mismatchedRevisionError = /has OCI revision "other-revision"; expected 0123456789abcdef/;
const multiPlatformError = /must be a multi-platform OCI image index/;
const duplicatePlatformError = /contains a duplicate OCI platform/;
const invalidIndexDigestError =
  /Digest for ghcr\.io\/shipfoxhq\/api:build-42 must be a sha256 digest/;
const missingConfigDigestError =
  /Config digest for ghcr\.io\/shipfoxhq\/api:build-42 must be a sha256 digest/;

function registry(options = {}) {
  const {
    descriptorDigest = digest('a'),
    indexManifest,
    labelRevision = revision,
    omitConfigDigest = false,
  } = options;
  const platformDigests = [digest('b'), digest('c')];
  const configDigests = [digest('d'), digest('e')];
  const defaultIndexManifest = {
    manifests: [
      {
        digest: platformDigests[0],
        platform: {os: 'linux', architecture: 'amd64'},
      },
      {
        digest: platformDigests[1],
        platform: {os: 'linux', architecture: 'arm64', variant: 'v8'},
      },
    ],
  };

  return {
    fetchDescriptor() {
      return {digest: descriptorDigest};
    },
    fetchManifest(reference) {
      if (reference.includes(':build-')) {
        return indexManifest ?? defaultIndexManifest;
      }

      const platformIndex = platformDigests.findIndex((value) => reference.endsWith(value));
      if (omitConfigDigest) return {config: {}};
      return {config: {digest: configDigests[platformIndex]}};
    },
    fetchBlob() {
      return {config: {Labels: {'org.opencontainers.image.revision': labelRevision}}};
    },
  };
}

describe('resolveApplicationImages', () => {
  test('resolves the complete image set by immutable digest', () => {
    const images = resolveApplicationImages('build-42', revision, registry());

    assert.deepEqual(Object.keys(images), ['api', 'client', 'provisioner', 'runner']);
    assert.deepEqual(images.api, {
      repository: 'ghcr.io/shipfoxhq/api',
      digest: digest('a'),
      platforms: ['linux/amd64', 'linux/arm64/v8'],
      attestations: {
        provenance: {status: 'not-published'},
        sbom: {status: 'not-published'},
      },
    });
  });

  test('rejects an image whose OCI revision does not match the release', () => {
    const resolve = () =>
      resolveApplicationImages('build-42', revision, registry({labelRevision: 'other-revision'}));

    assert.throws(resolve, mismatchedRevisionError);
  });

  test('rejects a single-platform image manifest', () => {
    const resolve = () =>
      resolveApplicationImages(
        'build-42',
        revision,
        registry({indexManifest: {config: {digest: digest('d')}}}),
      );

    assert.throws(resolve, multiPlatformError);
  });

  test('rejects duplicate OCI platforms', () => {
    const resolve = () =>
      resolveApplicationImages(
        'build-42',
        revision,
        registry({
          indexManifest: {
            manifests: [
              {digest: digest('b'), platform: {os: 'linux', architecture: 'amd64'}},
              {digest: digest('c'), platform: {os: 'linux', architecture: 'amd64'}},
            ],
          },
        }),
      );

    assert.throws(resolve, duplicatePlatformError);
  });

  test('rejects an invalid image index digest', () => {
    const resolve = () =>
      resolveApplicationImages('build-42', revision, registry({descriptorDigest: 'latest'}));

    assert.throws(resolve, invalidIndexDigestError);
  });

  test('rejects a missing platform config digest', () => {
    const resolve = () =>
      resolveApplicationImages('build-42', revision, registry({omitConfigDigest: true}));

    assert.throws(resolve, missingConfigDigestError);
  });
});
