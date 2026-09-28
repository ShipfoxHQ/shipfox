import type {
  RegistryEnvelope,
  RegistryPackageKind,
  RegistryVersionDocument,
} from '@shipfox/registry-format';

/** A version fetched from a registry and verified against trusted keys. */
export interface RegistryVersion {
  registry: string;
  package: string;
  version: string;
  kind: RegistryPackageKind;
  /** Digest of the content bundle. */
  digest: string;
  envelope: RegistryEnvelope;
  document: RegistryVersionDocument;
  /** The gzip content bundle. */
  content: Uint8Array;
  /** The gzip source archive, fetched on first use. */
  source: Uint8Array | null;
  readme: string | null;
  fetchedAt: Date;
}
