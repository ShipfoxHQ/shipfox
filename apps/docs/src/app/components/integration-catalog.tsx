'use client';

import {Search, Webhook, X} from 'lucide-react';
import Link from 'next/link';
import {useMemo, useState} from 'react';
import {siGithub, siLinear, siSentry, siSlack} from 'simple-icons';
import {
  type CatalogIcon,
  type CatalogProvider,
  catalogAvailabilityLabels,
  catalogCapabilityLabels,
  catalogCategoryLabels,
  countFacetValues,
  emptyCatalogFilters,
  filterProviders,
  INTEGRATION_CATALOG_AVAILABILITIES,
  INTEGRATION_CATALOG_CAPABILITIES,
  INTEGRATION_CATALOG_CATEGORIES,
} from '@/lib/integration-catalog';

const availabilitySections = INTEGRATION_CATALOG_AVAILABILITIES;

interface IntegrationCatalogProps {
  providers: CatalogProvider[];
}

export function IntegrationCatalog({providers}: IntegrationCatalogProps) {
  const [filters, setFilters] = useState(emptyCatalogFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filteredProviders = useMemo(
    () => filterProviders(providers, filters),
    [filters, providers],
  );
  const facetCounts = useMemo(() => countFacetValues(providers, filters), [filters, providers]);
  const activeFilterCount = filters.capability.length + filters.category.length;
  const hasFilters = filters.query.length > 0 || activeFilterCount > 0;

  function clearFilters() {
    setFilters(emptyCatalogFilters);
  }

  return (
    <section
      aria-label="Integration catalog"
      className="not-prose my-8 grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_240px]"
    >
      <div className="lg:col-start-1">
        <label htmlFor="integration-catalog-search" className="sr-only">
          Search integrations
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fd-muted-foreground"
          />
          <input
            id="integration-catalog-search"
            type="search"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({...current, query: event.target.value}))}
            placeholder="Search by provider, type, or related term"
            className="h-11 w-full rounded-md border border-fd-border bg-fd-background py-2 pr-9 pl-10 text-sm text-fd-foreground outline-none placeholder:text-fd-muted-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
          />
          {filters.query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setFilters((current) => ({...current, query: ''}))}
              className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          aria-controls="integration-catalog-filters"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
          className="mt-4 min-h-11 w-full rounded-md border border-fd-border px-3 text-sm font-medium text-fd-foreground outline-none hover:bg-fd-muted focus-visible:ring-2 focus-visible:ring-fd-ring lg:hidden"
        >
          {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
        </button>
      </div>

      <aside
        id="integration-catalog-filters"
        aria-label="Filter integrations"
        className={`${filtersOpen ? 'block' : 'hidden'} border-t border-fd-border pt-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:!block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0`}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-fd-foreground">Filters</p>
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              Clear all
            </button>
          ) : null}
        </div>
        <div className="mt-6 space-y-6">
          <FacetGroup
            label="What it does"
            values={INTEGRATION_CATALOG_CAPABILITIES}
            selected={filters.capability}
            labels={catalogCapabilityLabels}
            counts={facetCounts.capability}
            onToggle={(value) =>
              setFilters((current) => ({
                ...current,
                capability: toggleFilter(current.capability, value),
              }))
            }
          />
          <FacetGroup
            label="Type"
            values={INTEGRATION_CATALOG_CATEGORIES}
            selected={filters.category}
            labels={catalogCategoryLabels}
            counts={facetCounts.category}
            onToggle={(value) =>
              setFilters((current) => ({
                ...current,
                category: toggleFilter(current.category, value),
              }))
            }
          />
        </div>
      </aside>

      <div className="lg:col-start-1">
        <p aria-live="polite" className="text-sm text-fd-muted-foreground">
          {filteredProviders.length}{' '}
          {filteredProviders.length === 1 ? 'integration' : 'integrations'} found
        </p>
        {activeFilterCount > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {filters.capability.map((capability) => (
              <FilterChip
                key={capability}
                label={catalogCapabilityLabels[capability]}
                onRemove={() =>
                  setFilters((current) => ({
                    ...current,
                    capability: removeFilter(current.capability, capability),
                  }))
                }
              />
            ))}
            {filters.category.map((category) => (
              <FilterChip
                key={category}
                label={catalogCategoryLabels[category]}
                onRemove={() =>
                  setFilters((current) => ({
                    ...current,
                    category: removeFilter(current.category, category),
                  }))
                }
              />
            ))}
          </div>
        ) : null}

        {filteredProviders.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-fd-border px-6 py-10 text-center">
            <p className="text-sm font-medium text-fd-foreground">
              No integrations match these filters
            </p>
            <p className="mt-2 text-sm text-fd-muted-foreground">
              Try another term or remove a filter.
            </p>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 min-h-11 rounded-md px-3 text-sm font-medium text-fd-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {availabilitySections.map((availability) => {
              const sectionProviders = filteredProviders.filter(
                (provider) => provider.availability === availability,
              );
              if (sectionProviders.length === 0) return null;

              return (
                <section
                  key={availability}
                  aria-labelledby={`${availability}-integrations`}
                  className="space-y-3"
                >
                  <h2
                    id={`${availability}-integrations`}
                    className="text-lg font-semibold text-fd-foreground"
                  >
                    {catalogAvailabilityLabels[availability]}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {sectionProviders.map((provider) => (
                      <IntegrationCard key={provider.slug} provider={provider} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

interface FacetGroupProps<Value extends string> {
  label: string;
  values: readonly Value[];
  selected: readonly Value[];
  labels: Record<Value, string>;
  counts: Record<Value, number>;
  onToggle: (value: Value) => void;
}

function FacetGroup<Value extends string>({
  label,
  values,
  selected,
  labels,
  counts,
  onToggle,
}: FacetGroupProps<Value>) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
        {label}
      </legend>
      <div>
        {values.map((value) => {
          const count = counts[value];
          const optionLabel = labels[value];
          const isSelected = selected.includes(value);

          return (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-2 py-1.5 text-sm ${
                count === 0 ? 'text-fd-muted-foreground' : 'text-fd-foreground'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(value)}
                aria-label={`${optionLabel}, ${count} results`}
                className="size-4 shrink-0 rounded border-fd-border accent-fd-primary focus-visible:ring-2 focus-visible:ring-fd-ring"
              />
              <span>{optionLabel}</span>
              <span className="ml-auto tabular-nums text-xs text-fd-muted-foreground">{count}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function FilterChip({label, onRemove}: {label: string; onRemove: () => void}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-fd-border bg-fd-muted px-2.5 py-1 text-xs text-fd-foreground">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

function IntegrationCard({provider}: {provider: CatalogProvider}) {
  return (
    <article className="flex min-h-56 flex-col rounded-lg border border-fd-border bg-fd-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={provider.overviewHref}
            className="flex items-start gap-3 font-semibold text-fd-foreground outline-none hover:text-fd-primary hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
          >
            <ProviderIcon icon={provider.icon} />
            <span>{provider.name}</span>
          </Link>
          <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{provider.summary}</p>
        </div>
        {provider.setupHref ? (
          <Link
            href={provider.setupHref}
            className="-mt-2 -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm font-medium text-fd-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
          >
            Set up
          </Link>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {provider.capabilities.map((capability) => (
          <span
            key={capability}
            className="rounded border border-fd-border bg-fd-muted px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-fd-muted-foreground"
          >
            {catalogCapabilityLabels[capability]}
          </span>
        ))}
      </div>

      {provider.eventCount > 0 || provider.toolCount > 0 ? (
        <p className="mt-3 text-xs text-fd-muted-foreground">
          {[
            provider.eventCount > 0 && `${provider.eventCount} events`,
            provider.toolCount > 0 && `${provider.toolCount} agent tools`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
    </article>
  );
}

function toggleFilter<Value>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function removeFilter<Value>(values: readonly Value[], value: Value): Value[] {
  return values.filter((item) => item !== value);
}

function ProviderIcon({icon}: {icon: CatalogIcon}) {
  if (icon === 'webhooks')
    return (
      <Webhook aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fd-muted-foreground" />
    );

  const brandIcon = {
    github: siGithub,
    sentry: siSentry,
    linear: siLinear,
    slack: siSlack,
  }[icon];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="mt-0.5 size-5 shrink-0 fill-current text-fd-muted-foreground"
    >
      <path d={brandIcon.path} />
    </svg>
  );
}
