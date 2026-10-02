import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {
  type CatalogEntry,
  countFacetValues,
  emptyCatalogFilters,
  filterCatalogEntries,
} from './integration-catalog';

const entries: CatalogEntry[] = [
  {
    availability: 'self_serve',
    slug: 'github',
    name: 'GitHub',
    summary: 'Source control and events',
    capabilities: ['source_control', 'events', 'agent_tools'],
    categories: ['source-control'],
    aliases: ['git'],
    icon: 'github',
    overviewHref: '/integrations/github',
    eventCount: githubEventCatalog.events.length,
    toolCount: 21,
  },
  {
    availability: 'self_serve',
    slug: 'sentry',
    name: 'Sentry',
    summary: 'Error events',
    capabilities: ['events'],
    categories: ['observability'],
    aliases: ['monitoring'],
    icon: 'sentry',
    overviewHref: '/integrations/sentry',
    eventCount: 5,
    toolCount: 0,
  },
  {
    availability: 'self_serve',
    slug: 'webhooks',
    name: 'Custom webhook',
    summary: 'Custom events',
    capabilities: ['events'],
    categories: ['built-in'],
    aliases: ['http'],
    icon: 'webhooks',
    overviewHref: '/integrations/webhooks',
    eventCount: 1,
    toolCount: 0,
  },
  {
    availability: 'self_serve',
    slug: 'linear',
    name: 'Linear',
    summary: 'Issue tracking',
    capabilities: ['agent_tools'],
    categories: ['issue-tracking'],
    aliases: ['issues'],
    icon: 'linear',
    overviewHref: '/integrations/linear',
    eventCount: 0,
    toolCount: 1,
  },
  {
    availability: 'on_request',
    slug: 'gitlab',
    name: 'GitLab',
    summary: 'Merge request events',
    categories: ['source-control'],
    aliases: ['git'],
    iconPath: 'M0 0h24v24H0z',
  },
];

describe('filterCatalogEntries', () => {
  it('returns every entry when no filters are selected', () => {
    const filtered = filterCatalogEntries(entries, emptyCatalogFilters);

    assert.deepEqual(filtered, entries);
  });

  it('matches on-request entries by query and category', () => {
    const filtered = filterCatalogEntries(entries, {
      ...emptyCatalogFilters,
      query: 'git',
      category: ['source-control'],
    });

    assert.deepEqual(
      filtered.map((entry) => entry.slug),
      ['github', 'gitlab'],
    );
  });

  it('filters entries by availability', () => {
    const filtered = filterCatalogEntries(entries, {
      ...emptyCatalogFilters,
      availability: ['on_request'],
    });

    assert.deepEqual(
      filtered.map((entry) => entry.slug),
      ['gitlab'],
    );
  });

  it('filters providers by query and selected facet groups', () => {
    const filtered = filterCatalogEntries(entries, {
      ...emptyCatalogFilters,
      query: 'git',
      capability: ['events'],
      category: ['source-control'],
    });

    assert.deepEqual(
      filtered.map((entry) => entry.slug),
      ['github'],
    );
  });

  it('matches any selected capability within a facet group', () => {
    const filtered = filterCatalogEntries(entries, {
      ...emptyCatalogFilters,
      capability: ['events', 'agent_tools'],
    });

    assert.deepEqual(
      filtered.map((entry) => entry.slug),
      ['github', 'sentry', 'webhooks', 'linear'],
    );
  });
});

describe('countFacetValues', () => {
  it('keeps counts disjunctive within a facet group', () => {
    const counts = countFacetValues(entries, {
      ...emptyCatalogFilters,
      capability: ['events'],
      category: ['source-control'],
    });

    assert.deepEqual(counts.capability, {
      source_control: 1,
      events: 1,
      agent_tools: 1,
    });
    assert.equal(counts.category['source-control'], 1);
    assert.equal(counts.category.observability, 1);
    assert.equal(counts.category['built-in'], 1);
    assert.equal(counts.category['issue-tracking'], 0);
    assert.deepEqual(counts.availability, {self_serve: 1, on_request: 0});
  });

  it('counts on-request entries only when no capability is selected', () => {
    const counts = countFacetValues(entries, {
      ...emptyCatalogFilters,
      category: ['source-control'],
    });

    assert.deepEqual(counts.availability, {self_serve: 1, on_request: 1});
  });
});
