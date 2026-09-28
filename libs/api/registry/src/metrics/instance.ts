import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {RegistryPackageKind} from '@shipfox/registry-format';

/** `any` when the caller did not name the package kind. */
export type RegistryMetricKind = RegistryPackageKind | 'any';

export type RegistryFetchResult =
  | 'ok'
  | 'not-found'
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
  {description: 'Registry versions served from the cache after verification'},
);
