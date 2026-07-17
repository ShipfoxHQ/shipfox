'use client';

import {Combobox, type ComboboxOption} from '@shipfox/react-ui/combobox';
import {Webhook} from 'lucide-react';
import Link from 'next/link';
import {type ReactNode, useMemo, useState} from 'react';
import {siGithub, siLinear, siSentry, siSlack} from 'simple-icons';
import {
  type CatalogAvailability,
  type CatalogIcon,
  type CatalogProvider,
  catalogAvailabilityLabels,
  catalogCapabilityLabels,
  catalogCategoryLabels,
  emptyCatalogFilters,
  filterProviders,
  INTEGRATION_CATALOG_AVAILABILITIES,
  INTEGRATION_CATALOG_CAPABILITIES,
  INTEGRATION_CATALOG_CATEGORIES,
} from '@/lib/integration-catalog';

const availabilitySections = INTEGRATION_CATALOG_AVAILABILITIES;
const capabilityOptions: ComboboxOption[] = INTEGRATION_CATALOG_CAPABILITIES.map((capability) => ({
  value: capability,
  label: catalogCapabilityLabels[capability],
}));
const availabilityOptions: ComboboxOption[] = INTEGRATION_CATALOG_AVAILABILITIES.map(
  (availability) => ({
    value: availability,
    label: catalogAvailabilityLabels[availability],
  }),
);
const categoryOptions: ComboboxOption[] = INTEGRATION_CATALOG_CATEGORIES.map((category) => ({
  value: category,
  label: catalogCategoryLabels[category],
}));

const availabilityClasses: Record<CatalogAvailability, string> = {
  available: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  preview: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'coming-soon': 'border-fd-border bg-fd-muted text-fd-muted-foreground',
};

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
  const hasFilters =
    filters.query.length > 0 ||
    filters.availability.length > 0 ||
    filters.capability.length > 0 ||
    filters.category.length > 0;
  const activeFilterCount =
    filters.availability.length + filters.capability.length + filters.category.length;

  return (
    <section aria-label="Integration catalog" className="not-prose my-8 space-y-6">
      <div className="space-y-4 rounded-lg border border-fd-border bg-fd-card p-4 sm:p-5">
        <div className="lg:grid lg:grid-cols-[minmax(14rem,1fr)_repeat(3,minmax(0,11rem))] lg:items-end lg:gap-3">
          <div>
            <label
              htmlFor="integration-catalog-search"
              className="text-sm font-medium text-fd-foreground"
            >
              Search integrations
            </label>
            <input
              id="integration-catalog-search"
              type="search"
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({...current, query: event.target.value}))
              }
              placeholder="Search by provider, category, or related term"
              className="mt-2 min-h-11 w-full rounded-md border border-fd-border bg-fd-background px-3 text-sm text-fd-foreground outline-none placeholder:text-fd-muted-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
            />
          </div>
          <div className="mt-4 flex justify-end lg:hidden">
            <button
              type="button"
              aria-controls="integration-catalog-filters"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              className="min-h-11 rounded-md border border-fd-border px-3 text-sm font-medium text-fd-foreground outline-none hover:bg-fd-muted focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
            </button>
          </div>
          <div
            id="integration-catalog-filters"
            className={`${filtersOpen ? 'grid' : 'hidden'} mt-4 gap-4 sm:grid-cols-2 lg:!grid lg:mt-0 lg:grid-cols-3 lg:gap-3`}
          >
            <CatalogFilterField label="Availability" htmlFor="integration-catalog-availability">
              <Combobox
                id="integration-catalog-availability"
                multiple
                options={availabilityOptions}
                value={[...filters.availability]}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    availability: toCatalogValues(value, INTEGRATION_CATALOG_AVAILABILITIES),
                  }))
                }
                placeholder="All availability"
                searchPlaceholder="Search availability"
                emptyState="No availability found."
                className="integration-catalog-combobox mt-2"
                popoverClassName="integration-catalog-combobox integration-catalog-combobox-popover"
                maxVisibleChips={2}
              />
            </CatalogFilterField>
            <CatalogFilterField label="Capability" htmlFor="integration-catalog-capabilities">
              <Combobox
                id="integration-catalog-capabilities"
                multiple
                options={capabilityOptions}
                value={[...filters.capability]}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    capability: toCatalogValues(value, INTEGRATION_CATALOG_CAPABILITIES),
                  }))
                }
                placeholder="All capabilities"
                searchPlaceholder="Search capabilities"
                emptyState="No capabilities found."
                className="integration-catalog-combobox mt-2"
                popoverClassName="integration-catalog-combobox integration-catalog-combobox-popover"
                maxVisibleChips={2}
              />
            </CatalogFilterField>
            <CatalogFilterField label="Category" htmlFor="integration-catalog-category">
              <Combobox
                id="integration-catalog-category"
                multiple
                options={categoryOptions}
                value={[...filters.category]}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    category: toCatalogValues(value, INTEGRATION_CATALOG_CATEGORIES),
                  }))
                }
                placeholder="All categories"
                searchPlaceholder="Search categories"
                emptyState="No categories found."
                className="integration-catalog-combobox mt-2"
                popoverClassName="integration-catalog-combobox integration-catalog-combobox-popover"
                maxVisibleChips={2}
              />
            </CatalogFilterField>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-fd-muted-foreground">
        {filteredProviders.length} {filteredProviders.length === 1 ? 'integration' : 'integrations'}{' '}
        found
      </p>

      {filteredProviders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-fd-border px-6 py-10 text-center">
          <p className="text-sm font-medium text-fd-foreground">
            No integrations match these filters
          </p>
          <p className="mt-2 text-sm text-fd-muted-foreground">
            Try another term or remove a filter.
          </p>
          {hasFilters && (
            <button
              type="button"
              onClick={() => setFilters(emptyCatalogFilters)}
              className="mt-4 min-h-11 rounded-md px-3 text-sm font-medium text-fd-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        availabilitySections.map((availability) => {
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
        })
      )}
    </section>
  );
}

interface CatalogFilterFieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
}

function CatalogFilterField({label, htmlFor, children}: CatalogFilterFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium text-fd-foreground">
        {label}
      </label>
      {children}
    </div>
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
        {provider.setupHref && (
          <Link
            href={provider.setupHref}
            className="-mt-2 -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm font-medium text-fd-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
          >
            Set up
          </Link>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {provider.availability !== 'available' && (
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${availabilityClasses[provider.availability]}`}
          >
            {catalogAvailabilityLabels[provider.availability]}
          </span>
        )}
        {provider.capabilities.map((capability) => (
          <span
            key={capability}
            className="rounded border border-fd-border bg-fd-muted px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-fd-muted-foreground"
          >
            {catalogCapabilityLabels[capability]}
          </span>
        ))}
      </div>

      {(provider.eventCount > 0 || provider.toolCount > 0) && (
        <p className="mt-3 text-xs text-fd-muted-foreground">
          {[
            provider.eventCount > 0 && `${provider.eventCount} events`,
            provider.toolCount > 0 && `${provider.toolCount} agent tools`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </article>
  );
}

function toCatalogValues<Value extends string>(
  values: string[],
  allowed: readonly Value[],
): Value[] {
  return values.filter((value): value is Value =>
    allowed.some((allowedValue) => allowedValue === value),
  );
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
