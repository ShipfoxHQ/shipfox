import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {SHIPFOX_BUILTIN_CONNECTION_ID, shipfoxEventCatalog, shipfoxEventNames} from './index.js';

describe('Shipfox event catalog', () => {
  it('lists every lifecycle event with its payload schema', () => {
    expect(integrationEventCatalogIssues(shipfoxEventCatalog)).toEqual([]);
    expect(shipfoxEventCatalog.events.map((event) => event.name)).toEqual(shipfoxEventNames);
    expect(shipfoxEventCatalog.families.every((family) => family.payloadSchema)).toBe(true);
  });

  it('exports the six lifecycle event names and built-in connection ID', () => {
    expect(shipfoxEventNames).toEqual([
      'run.requested',
      'run.started',
      'run.completed',
      'job.queued',
      'job.started',
      'job.completed',
    ]);
    expect(SHIPFOX_BUILTIN_CONNECTION_ID).toBe('00000000-0000-4000-8000-000000000001');
  });
});
