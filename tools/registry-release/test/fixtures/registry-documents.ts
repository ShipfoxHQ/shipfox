import type {RegistryTemplateVersionDocument} from '@shipfox/registry-format';
import {deriveTemplateMetadata, type WorkflowTemplateManifest} from '@shipfox/workflow-templates';
import type {BuiltPackage} from '../../src/build.js';

/** The version document a registry would store after publishing `built`. */
export function publishedDocument(
  built: BuiltPackage,
  overrides: Partial<RegistryTemplateVersionDocument> = {},
): RegistryTemplateVersionDocument {
  return {
    schema: 'shipfox.registry/version@1',
    package: built.package,
    kind: 'template',
    version: built.version,
    visibility: 'public',
    fingerprint: built.fingerprint,
    published_at: '2026-10-12T09:14:03Z',
    license: built.license ?? 'MIT',
    content: {
      digest: built.content.digest,
      bytes: built.content.bytes,
      format: built.content.format,
    },
    source: {digest: built.source.digest, bytes: built.source.bytes, format: built.source.format},
    manifest: built.manifest,
    derived: deriveTemplateMetadata({
      manifest: built.manifest as WorkflowTemplateManifest,
      contentBytes: built.content.bytes,
    }),
    actions: built.actions,
    composition: built.composition ?? 1,
    builder: built.builder,
    provenance: {
      issuer: 'https://token.actions.githubusercontent.com',
      repository: 'ShipfoxHQ/shipfox',
      repository_id: '812345678',
      repository_owner_id: '1234567',
      commit: '3066dabaa0000000000000000000000000000000',
      ref: 'refs/pull/2210/merge',
      workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/pull/2210/merge',
      run_id: '17000000001',
      run_attempt: '1',
      path: built.path,
    },
    ...overrides,
  };
}
