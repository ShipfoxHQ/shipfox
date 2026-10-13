import type {UsageModuleClient} from '@shipfox/api-usage-dto/inter-module';
import {
  type RecordStorageSamplesResult,
  recordStorageSamples,
} from '#core/record-storage-samples.js';

export function createRecordStorageSamplesActivity({usage}: {usage: UsageModuleClient}) {
  return function recordStorageSamplesActivity(): Promise<RecordStorageSamplesResult> {
    return recordStorageSamples({usage});
  };
}
