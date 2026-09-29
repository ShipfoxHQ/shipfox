import type {RegistryTrustedKey} from '@shipfox/registry-format';

export interface RegistrySettings {
  /** The normalized registry URL. Empty when registry references are disabled. */
  registry: string;
  trustedKeys: RegistryTrustedKey[];
  /** How long a cached catalog or package index is served before a read refreshes it. */
  catalogRefreshSeconds: number;
}
