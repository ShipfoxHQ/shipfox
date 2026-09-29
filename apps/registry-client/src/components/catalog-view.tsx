import {Header} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils/cn';
import type {RegistryCatalogEntry, RegistryPackageKind} from '@shipfox/registry-format';
import {Search} from 'lucide-react';
import Form from 'next/form';
import Link from 'next/link';
import type {CatalogFilters} from '@/lib/catalog';
import {packagePath} from '@/lib/urls';
import {KindBadge} from './kind-badge';
import {ProviderIcons} from './provider-icon';
import {Publisher} from './publisher';

const KIND_FILTERS: {kind?: RegistryPackageKind; label: string}[] = [
  {label: 'All'},
  {kind: 'template', label: 'Templates'},
  {kind: 'action', label: 'Actions'},
];

export function CatalogView({
  packages,
  filters,
}: {
  packages: RegistryCatalogEntry[];
  filters: CatalogFilters;
}) {
  return (
    <div className="flex flex-col gap-region">
      <div className="flex flex-col gap-inline">
        <Header variant="h1" className="text-foreground-neutral-base">
          Registry
        </Header>
        <p className="max-w-[640px] text-md text-foreground-neutral-subtle">
          Workflow templates and actions for Shipfox. Every version is signed, and a published
          version never changes.
        </p>
      </div>

      <div className="flex flex-col gap-group">
        <div className="flex flex-col gap-cluster md:flex-row md:items-center">
          <Form action="/" role="search" className="flex-1">
            {filters.kind ? <input type="hidden" name="kind" value={filters.kind} /> : null}
            <label className="flex min-h-40 items-center gap-inline rounded-6 border border-border-neutral-base bg-background-field-base px-row focus-within:shadow-focus-inset">
              <Search
                aria-hidden="true"
                className="size-16 shrink-0 text-foreground-neutral-muted"
              />
              <span className="sr-only">Search packages</span>
              <input
                type="search"
                name="q"
                defaultValue={filters.query}
                maxLength={100}
                placeholder="Search by outcome, integration, or keyword"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground-neutral-base outline-none placeholder:text-foreground-neutral-muted"
              />
            </label>
          </Form>
          <nav aria-label="Package kind" className="flex gap-tight">
            {KIND_FILTERS.map(({kind, label}) => {
              const current = filters.kind === kind;
              return (
                <Link
                  key={label}
                  href={{
                    pathname: '/',
                    query: {...(kind ? {kind} : {}), ...(filters.query ? {q: filters.query} : {})},
                  }}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-32 items-center rounded-6 border px-10 text-sm transition-colors focus-visible:shadow-focus-inset focus-visible:outline-none',
                    current
                      ? 'border-border-highlights-interactive bg-background-highlight-base text-foreground-neutral-base'
                      : 'border-border-neutral-base text-foreground-neutral-subtle hover:text-foreground-neutral-base',
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <p aria-live="polite" className="text-sm text-foreground-neutral-muted">
          {packages.length} {packages.length === 1 ? 'package' : 'packages'}
        </p>

        {packages.length === 0 ? (
          <div className="flex flex-col items-center gap-inline rounded-8 border border-dashed border-border-neutral-base p-panel text-center">
            <p className="text-sm font-medium text-foreground-neutral-base">No packages match</p>
            <Link href="/" className="text-sm text-foreground-highlight-interactive underline">
              Show every package
            </Link>
          </div>
        ) : (
          <ul className="grid gap-group sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((entry) => (
              <li key={entry.package}>
                <PackageCard entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PackageCard({entry}: {entry: RegistryCatalogEntry}) {
  return (
    <Link
      href={packagePath(entry.package)}
      className="group flex h-full flex-col gap-group rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact shadow-button-neutral transition-colors hover:bg-background-neutral-hover focus-visible:shadow-focus-inset focus-visible:outline-none"
    >
      <span className="flex flex-col gap-tight">
        <span className="flex items-start justify-between gap-inline">
          <span className="font-medium text-foreground-neutral-base group-hover:underline">
            {entry.title}
          </span>
          <KindBadge kind={entry.kind} />
        </span>
        <span className="line-clamp-2 text-sm text-foreground-neutral-subtle">{entry.summary}</span>
      </span>
      <span className="mt-auto flex flex-col gap-inline">
        <span className="truncate font-code text-xs text-foreground-neutral-muted">
          {entry.package}@{entry.latest}
        </span>
        <span className="flex items-center justify-between gap-inline text-xs text-foreground-neutral-subtle">
          <Publisher
            displayName={entry.publisher.display_name}
            verified={entry.publisher.verified}
          />
          <ProviderIcons providers={entry.integrations} />
        </span>
      </span>
    </Link>
  );
}
