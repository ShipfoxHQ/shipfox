import type {
  RegistryActionVersionDocument,
  RegistryTemplateVersionDocument,
} from '@shipfox/registry-format';
import {deriveTemplateMetadata, type WorkflowTemplateManifest} from '@shipfox/workflow-templates';
import type {BuiltPackage} from '../../src/build.js';

function provenance(path: string) {
  return {
    issuer: 'https://token.actions.githubusercontent.com',
    repository: 'ShipfoxHQ/shipfox',
    repository_id: '812345678',
    repository_owner_id: '1234567',
    commit: '3066dabaa0000000000000000000000000000000',
    ref: 'refs/pull/2210/merge',
    workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/pull/2210/merge',
    run_id: '17000000001',
    run_attempt: '1',
    path,
  };
}

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
      format: 'template-bundle@1',
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
    provenance: provenance(built.path),
    ...overrides,
  };
}

/** A minimal published action, for templates that use one. */
export function publishedActionDocument({
  package: name,
  version = '1.0.0',
}: {
  package: string;
  version?: string;
}): RegistryActionVersionDocument {
  const digest = (character: string) => `sha256:${character.repeat(64)}`;
  return {
    schema: 'shipfox.registry/version@1',
    package: name,
    kind: 'action',
    version,
    visibility: 'public',
    fingerprint: digest('a'),
    published_at: '2026-10-12T09:14:03Z',
    license: 'MIT',
    content: {digest: digest('b'), bytes: 10, format: 'action-bundle@1'},
    source: {digest: digest('c'), bytes: 10, format: 'source-archive@1'},
    manifest: {description: 'An action.', main: 'index.mjs'},
    derived: {
      integrations: [],
      capabilities: {},
      interface: {inputs: {}, outputs: {}},
      usage: `uses: ${name}@${version}\n`,
      size: 10,
    },
    dependencies: [],
    actions: [],
    builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1},
    provenance: provenance('catalog/actions/x'),
  };
}
