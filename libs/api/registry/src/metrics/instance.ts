import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {RegistryPackageKind} from '@shipfox/registry-format';

/** `any` when the caller did not name the package kind; the indexes have their own kinds. */
export type RegistryMetricKind = RegistryPackageKind | 'any' | 'catalog' | 'package-index';

export type RegistryFetchResult =
  | 'ok'
  | 'not-found'
  | 'not-modified'
  | 'unavailable'
  | 'signature-invalid'
  | 'schema-unsupported';

const meter = instanceMetrics.getMeter('registry');

export const registryFetch = meter.createCounter<{
  kind: RegistryMetricKind;
  result: RegistryFetchResult;
}>('registry_fetch', {description: 'Registry version fetches by kind and result'});

export const registryCacheHit = meter.createCounter<{kind: RegistryMetricKind}>(
  'registry_cache_hit',
  {description: 'Registry versions and indexes served from the cache'},
);
