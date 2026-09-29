import {catalogEntry} from '#test/fixtures/documents.js';
import {startFixtureApi} from '#test/fixtures/registry-api.js';
import {RegistryApi, RegistryApiError} from './registry-api';

describe('RegistryApi', () => {
  it('follows the catalog cursor across pages, with the filters on every page', async () => {
    const first = catalogEntry({package: 'shipfox/ticket-to-pr', title: 'Task to pull request'});
    const second = catalogEntry({package: 'shipfox/fix-dependency-ci', title: 'Fix dependency CI'});
    const api = await startFixtureApi({
      '/v1/packages?kind=template&q=ci': {body: {packages: [first], next_cursor: 'MTAw'}},
      '/v1/packages?kind=template&q=ci&cursor=MTAw': {body: {packages: [second]}},
    });

    try {
      const packages = await new RegistryApi(`${api.url}/`).listPackages({
        kind: 'template',
        query: 'ci',
      });

      expect(packages.map((entry) => entry.package)).toEqual([
        'shipfox/ticket-to-pr',
        'shipfox/fix-dependency-ci',
      ]);
    } finally {
      await api.close();
    }
  });

  it('reads a 404 as a missing package', async () => {
    const api = await startFixtureApi({});

    try {
      const index = await new RegistryApi(api.url).getPackageIndex('shipfox/missing');

      expect(index).toBeUndefined();
    } finally {
      await api.close();
    }
  });

  it('throws on any other failure', async () => {
    const api = await startFixtureApi({'/v1/packages': {status: 503, body: {code: 'unavailable'}}});

    try {
      const listing = new RegistryApi(api.url).listPackages();

      await expect(listing).rejects.toThrow(RegistryApiError);
    } finally {
      await api.close();
    }
  });
});
