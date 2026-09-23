import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registeredIntegrationProviders,
  sortRegisteredIntegrationProviders,
} from '@/lib/registered-integration-providers';

const expectedProviderOrder = [
  'shipfox',
  'github',
  'linear',
  'jira',
  'clickup',
  'notion',
  'sentry',
  'posthog',
  'slack',
  'webhooks',
];

test('sorts registered providers by category and display priority', () => {
  const providers = registeredIntegrationProviders
    .filter((provider) => provider.kind === 'catalog')
    .map((provider) => ({slug: provider.slug, name: provider.slug}))
    .reverse();

  const sorted = sortRegisteredIntegrationProviders(providers);

  assert.deepEqual(
    sorted.map((provider) => provider.slug),
    expectedProviderOrder,
  );
});

test('uses provider name as the deterministic fallback', () => {
  const sorted = sortRegisteredIntegrationProviders([
    {slug: 'unknown-z', name: 'Zulu'},
    {slug: 'unknown-a', name: 'Alpha'},
  ]);

  assert.deepEqual(
    sorted.map((provider) => provider.slug),
    ['unknown-a', 'unknown-z'],
  );
});

test('assigns unique display priorities within each category', () => {
  const categoryPriorities = registeredIntegrationProviders.flatMap((provider) =>
    provider.kind === 'catalog' ? [`${provider.category}:${provider.displayPriority}`] : [],
  );

  assert.equal(new Set(categoryPriorities).size, categoryPriorities.length);
});
