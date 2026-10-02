'use client';

import {ArrowRight, ArrowUpRight, Search, Webhook, X} from 'lucide-react';
import Link from 'next/link';
import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {
  siClickup,
  siGithub,
  siJira,
  siLinear,
  siNotion,
  siPosthog,
  siSentry,
  siSlack,
} from 'simple-icons';
import {captureDocsEvent} from '@/lib/docs-analytics';
import {nextCatalogSearchState, normalizeCatalogQuery} from '@/lib/docs-analytics-core';
import {
  type CatalogEntry,
  type CatalogFilters,
  type CatalogIcon,
  type CatalogProvider,
  catalogAvailabilityLabels,
  catalogCapabilityLabels,
  catalogCategoryLabels,
  countFacetValues,
  emptyCatalogFilters,
  filterCatalogEntries,
  INTEGRATION_CATALOG_AVAILABILITIES,
  INTEGRATION_CATALOG_CAPABILITIES,
  INTEGRATION_CATALOG_CATEGORIES,
  integrationRequestHref,
  type RequestableIntegration,
} from '@/lib/integration-catalog';
import {
  catalogFilterChangedProperties,
  catalogResultClickedProperties,
  catalogSearchProperties,
} from '@/lib/integration-catalog-analytics';

interface IntegrationCatalogProps {
  entries: CatalogEntry[];
}

type FacetKey = 'availability' | 'capability' | 'category';

export function IntegrationCatalog({entries}: IntegrationCatalogProps) {
  const [filters, setFilters] = useState(emptyCatalogFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const lastCapturedQuery = useRef<string | null>(null);
  const filteredEntries = useMemo(() => filterCatalogEntries(entries, filters), [filters, entries]);
  const facetCounts = useMemo(() => countFacetValues(entries, filters), [filters, entries]);
  const selfServeEntries = filteredEntries.filter((entry) => entry.availability === 'self_serve');
  const onRequestEntries = filteredEntries.filter((entry) => entry.availability === 'on_request');
  const activeFilterCount =
    filters.availability.length + filters.capability.length + filters.category.length;
  const hasFilters = filters.query.length > 0 || activeFilterCount > 0;

  useEffect(() => {
    const query = normalizeCatalogQuery(filters.query);
    if (query.queryLength === 0) {
      lastCapturedQuery.current = null;
      return;
    }

    const timer = window.setTimeout(() => {
      const searchState = nextCatalogSearchState(lastCapturedQuery.current, query.dedupeKey);
      lastCapturedQuery.current = searchState.lastQuery;
      if (searchState.capture)
        captureDocsEvent(
          'docs_catalog_searched',
          catalogSearchProperties(filters, filteredEntries.length),
        );
    }, 750);

    return () => window.clearTimeout(timer);
  }, [filteredEntries.length, filters]);

  function clearFilters() {
    if (hasFilters)
      captureDocsEvent(
        'docs_catalog_filter_changed',
        catalogFilterChangedProperties(entries, emptyCatalogFilters, {
          facet: 'all',
          value: 'all',
          action: 'cleared',
        }),
      );
    setFilters(emptyCatalogFilters);
  }

  function changeFacet(
    facet: FacetKey,
    value: string,
    nextFilters: CatalogFilters,
    action: 'selected' | 'removed',
  ) {
    setFilters(nextFilters);
    captureDocsEvent(
      'docs_catalog_filter_changed',
      catalogFilterChangedProperties(entries, nextFilters, {facet, value, action}),
    );
  }

  function toggleAvailability(value: (typeof INTEGRATION_CATALOG_AVAILABILITIES)[number]) {
    changeFacet(
      'availability',
      value,
      {...filters, availability: toggleFilter(filters.availability, value)},
      filters.availability.includes(value) ? 'removed' : 'selected',
    );
  }

  function toggleCapability(value: (typeof INTEGRATION_CATALOG_CAPABILITIES)[number]) {
    changeFacet(
      'capability',
      value,
      {...filters, capability: toggleFilter(filters.capability, value)},
      filters.capability.includes(value) ? 'removed' : 'selected',
    );
  }

  function toggleCategory(value: (typeof INTEGRATION_CATALOG_CATEGORIES)[number]) {
    changeFacet(
      'category',
      value,
      {...filters, category: toggleFilter(filters.category, value)},
      filters.category.includes(value) ? 'removed' : 'selected',
    );
  }

  function captureResultClick(entry: CatalogEntry, target: 'overview' | 'setup' | 'request') {
    captureDocsEvent(
      'docs_catalog_result_clicked',
      catalogResultClickedProperties(filters, filteredEntries, entry, target),
    );
  }

  return (
    <section
      aria-label="Integration catalog"
      className="not-prose my-region grid gap-region lg:grid-cols-[minmax(0,1fr)_240px]"
    >
      <div className="flex flex-col gap-group lg:col-start-1">
        <label htmlFor="integration-catalog-search" className="sr-only">
          Search integrations
        </label>
        <div className="flex min-h-11 items-center gap-tight rounded-md border border-fd-border bg-fd-background px-row py-row outline-none focus-within:ring-2 focus-within:ring-fd-ring">
          <Search
            aria-hidden="true"
            className="pointer-events-none size-4 shrink-0 text-fd-muted-foreground"
          />
          <input
            id="integration-catalog-search"
            type="search"
            value={filters.query}
            data-ph-no-autocapture=""
            onChange={(event) => setFilters((current) => ({...current, query: event.target.value}))}
            placeholder="Search by provider, type, or related term"
            className="min-w-0 flex-1 bg-transparent text-sm text-fd-foreground outline-none placeholder:text-fd-muted-foreground"
          />
          {filters.query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setFilters((current) => ({...current, query: ''}))}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
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
          className="min-h-11 w-full rounded-md border border-fd-border p-tight text-sm font-medium text-fd-foreground outline-none hover:bg-fd-muted focus-visible:ring-2 focus-visible:ring-fd-ring lg:hidden"
        >
          {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
        </button>
      </div>

      <aside
        id="integration-catalog-filters"
        aria-label="Filter integrations"
        className={`${filtersOpen ? 'block' : 'hidden'} flex flex-col gap-section border-t border-fd-border p-panel-compact lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:!flex lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pb-0 lg:pr-0 lg:pt-0 lg:px-frame`}
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
        <div className="flex flex-col gap-section">
          <FacetGroup
            label="Availability"
            values={INTEGRATION_CATALOG_AVAILABILITIES}
            selected={filters.availability}
            labels={catalogAvailabilityLabels}
            counts={facetCounts.availability}
            onToggle={toggleAvailability}
          />
          <FacetGroup
            label="What it does"
            values={INTEGRATION_CATALOG_CAPABILITIES}
            selected={filters.capability}
            labels={catalogCapabilityLabels}
            counts={facetCounts.capability}
            onToggle={toggleCapability}
          />
          <FacetGroup
            label="Type"
            values={INTEGRATION_CATALOG_CATEGORIES}
            selected={filters.category}
            labels={catalogCategoryLabels}
            counts={facetCounts.category}
            onToggle={toggleCategory}
          />
        </div>
      </aside>

      <div className="flex flex-col gap-section lg:col-start-1">
        <div className="flex flex-col gap-cluster">
          <p aria-live="polite" className="text-sm text-fd-muted-foreground">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'integration' : 'integrations'}{' '}
            found
          </p>
          {activeFilterCount > 0 ? (
            <div className="flex flex-wrap gap-inline">
              {filters.availability.map((availability) => (
                <FilterChip
                  key={availability}
                  label={catalogAvailabilityLabels[availability]}
                  onRemove={() => toggleAvailability(availability)}
                />
              ))}
              {filters.capability.map((capability) => (
                <FilterChip
                  key={capability}
                  label={catalogCapabilityLabels[capability]}
                  onRemove={() => toggleCapability(capability)}
                />
              ))}
              {filters.category.map((category) => (
                <FilterChip
                  key={category}
                  label={catalogCategoryLabels[category]}
                  onRemove={() => toggleCategory(category)}
                />
              ))}
            </div>
          ) : null}
        </div>

        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center gap-group rounded-lg border border-dashed border-fd-border p-panel text-center">
            <div className="flex flex-col items-center gap-inline">
              <p className="text-sm font-medium text-fd-foreground">
                No integrations match these filters
              </p>
              <p className="text-sm text-fd-muted-foreground">
                Try another term or remove a filter. If your tool isn't listed,{' '}
                <RequestLink>request it</RequestLink>.
              </p>
            </div>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-11 rounded-md p-tight text-sm font-medium text-fd-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {selfServeEntries.length > 0 ? (
              <CatalogSection
                id="ready-to-connect"
                title="Ready to connect"
                gridClassName="sm:grid-cols-2"
                description="Connect these yourself from your workspace."
              >
                {selfServeEntries.map((entry) => (
                  <SelfServeCard
                    key={entry.slug}
                    provider={entry}
                    onNavigate={(target) => captureResultClick(entry, target)}
                  />
                ))}
              </CatalogSection>
            ) : null}
            {onRequestEntries.length > 0 ? (
              <CatalogSection
                id="available-on-request"
                title="Available on request"
                gridClassName="sm:grid-cols-2 xl:grid-cols-3"
                description="Request access and Shipfox enables it for your workspace."
                footer={
                  <p className="text-sm text-fd-muted-foreground">
                    Not listed? <RequestLink>Request another integration</RequestLink>.
                  </p>
                }
              >
                {onRequestEntries.map((entry) => (
                  <OnRequestCard
                    key={entry.slug}
                    integration={entry}
                    onRequest={() => captureResultClick(entry, 'request')}
                  />
                ))}
              </CatalogSection>
            ) : null}
          </>
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
    <fieldset className="flex flex-col gap-inline">
      <legend className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
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
              className={`flex cursor-pointer items-center gap-inline p-tight text-sm ${
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
    <span className="inline-flex items-center gap-tight rounded-full border border-fd-border bg-fd-muted p-tight text-xs text-fd-foreground">
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

function CatalogSection({
  id,
  title,
  description,
  gridClassName,
  footer,
  children,
}: {
  id: string;
  title: string;
  description: string;
  gridClassName: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-group">
      <div className="flex flex-col gap-tight">
        <h2 id={id} className="text-base font-semibold text-fd-foreground">
          {title}
        </h2>
        <p className="text-sm text-fd-muted-foreground">{description}</p>
      </div>
      <ul className={`grid gap-group ${gridClassName}`}>{children}</ul>
      {footer}
    </section>
  );
}

const cardClassName =
  'relative flex flex-col gap-group rounded-lg border p-panel-compact transition-colors hover:border-fd-primary/40 hover:bg-fd-accent/40';
// Stretches the card's primary link over the whole card, so secondary links
// stay separate anchors instead of nesting inside it.
const stretchedLinkClassName =
  'outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-fd-ring';

function SelfServeCard({
  provider,
  onNavigate,
}: {
  provider: CatalogProvider;
  onNavigate: (target: 'overview' | 'setup') => void;
}) {
  const details = [
    provider.capabilities.includes('source_control') && 'Code checkout',
    provider.eventCount > 0 &&
      `${provider.eventCount} ${provider.eventCount === 1 ? 'event' : 'events'}`,
    provider.toolCount > 0 &&
      `${provider.toolCount} ${provider.toolCount === 1 ? 'tool' : 'tools'}`,
  ].filter(Boolean);

  return (
    <li className={`${cardClassName} border-fd-border bg-fd-card`}>
      <div className="flex items-start gap-cluster">
        <ProviderIcon icon={provider.icon} />
        <span className="flex min-w-0 flex-1 flex-col gap-tight">
          <Link
            href={provider.overviewHref}
            onClick={() => onNavigate('overview')}
            className={`font-semibold leading-snug text-fd-foreground hover:underline ${stretchedLinkClassName}`}
          >
            {provider.name}
          </Link>
          {details.length > 0 ? (
            <span className="text-xs leading-4 text-fd-muted-foreground">
              {details.join(' · ')}
            </span>
          ) : null}
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-fd-muted-foreground">{provider.summary}</p>
      {provider.setupHref ? (
        <Link
          href={provider.setupHref}
          onClick={() => onNavigate('setup')}
          aria-label={`Set up ${provider.name}`}
          className="relative z-10 mt-auto inline-flex min-h-11 items-center gap-tight self-start rounded-md text-sm font-medium text-fd-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
        >
          Set up
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </li>
  );
}

function OnRequestCard({
  integration,
  onRequest,
}: {
  integration: RequestableIntegration;
  onRequest: () => void;
}) {
  return (
    <li className={`${cardClassName} border-dashed border-fd-border`}>
      <div className="flex items-center gap-cluster">
        <RequestableIcon integration={integration} />
        <span className="font-semibold leading-snug text-fd-foreground">{integration.name}</span>
      </div>
      <p className="line-clamp-3 text-sm text-fd-muted-foreground">{integration.summary}</p>
      <RequestLink
        integrationName={integration.name}
        onClick={onRequest}
        className={`mt-auto inline-flex min-h-11 items-center gap-tight self-start text-sm font-medium text-fd-foreground hover:underline ${stretchedLinkClassName}`}
      >
        Request access
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </RequestLink>
    </li>
  );
}

function RequestLink({
  integrationName,
  onClick,
  className = 'font-medium text-fd-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring',
  children,
}: {
  integrationName?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={integrationRequestHref(integrationName)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-label={integrationName ? `Request access to ${integrationName}` : undefined}
      className={className}
    >
      {children}
    </a>
  );
}

function toggleFilter<Value>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function RequestableIcon({integration}: {integration: RequestableIntegration}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 fill-current text-fd-muted-foreground"
    >
      <path d={integration.iconPath} />
    </svg>
  );
}

function ProviderIcon({icon}: {icon: CatalogIcon}) {
  if (icon === 'webhooks')
    return <Webhook aria-hidden="true" className="size-5 shrink-0 text-fd-foreground" />;
  if (icon === 'shipfox')
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 200 200"
        className="size-5 shrink-0 fill-current text-fd-foreground"
      >
        <path d="M35.4766 71.1779L87.8471 174.764C92.9421 184.842 107.058 184.842 112.153 174.764L164.523 71.1779L192.438 85.4265C200.787 89.6883 202.593 101.048 195.992 107.787L109.671 195.911C104.33 201.363 95.6704 201.363 90.3295 195.911L4.0079 107.787C-2.59278 101.048 -0.787007 89.6883 7.56226 85.4265L35.4766 71.1779ZM100 38.2425L171.913 1.53536C183.748 -4.50572 196.251 8.42284 190.182 20.4265L164.523 71.1779L100 38.2425ZM100 38.2425L28.0872 1.53536C16.2522 -4.50571 3.74943 8.42284 9.81817 20.4265L35.4766 71.1779L100 38.2425Z" />
      </svg>
    );

  const brandIcon = {
    clickup: siClickup,
    github: siGithub,
    jira: siJira,
    notion: siNotion,
    posthog: siPosthog,
    sentry: siSentry,
    linear: siLinear,
    slack: siSlack,
  }[icon];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 fill-current text-fd-foreground"
    >
      <path d={brandIcon.path} />
    </svg>
  );
}
