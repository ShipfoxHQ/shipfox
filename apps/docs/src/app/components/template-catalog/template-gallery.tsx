'use client';

import {Search, X, Zap} from 'lucide-react';
import Link from 'next/link';
import {useMemo, useState} from 'react';
import {
  TEMPLATE_GROUPS,
  type TemplateCatalogEntry,
  type TemplateGroup,
  type TemplateIcon as TemplateIconName,
  templateGroupLabels,
  templateIconLabels,
  templateIntegrations,
} from '@/lib/template-catalog/types';
import {TemplateIcon} from './template-icon';

interface Filters {
  query: string;
  integrations: TemplateIconName[];
  groups: TemplateGroup[];
}

const emptyFilters: Filters = {query: '', integrations: [], groups: []};

export function TemplateGallery({templates}: {templates: TemplateCatalogEntry[]}) {
  const [filters, setFilters] = useState(emptyFilters);
  const integrations = useMemo(
    () => [...new Set(templates.flatMap(templateIntegrations))].sort(),
    [templates],
  );
  const filtered = useMemo(() => filterTemplates(templates, filters), [templates, filters]);
  const hasFilters =
    filters.query.trim().length > 0 || filters.integrations.length > 0 || filters.groups.length > 0;

  return (
    <section
      aria-label="Example workflows"
      className="not-prose my-region grid gap-region lg:grid-cols-[minmax(0,1fr)_220px]"
    >
      <div className="flex flex-col gap-section lg:col-start-1">
        <div className="flex min-h-11 items-center gap-tight rounded-md border border-fd-border bg-fd-background px-row py-row focus-within:ring-2 focus-within:ring-fd-ring">
          <Search aria-hidden="true" className="size-4 shrink-0 text-fd-muted-foreground" />
          <input
            type="search"
            aria-label="Search examples"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({...current, query: event.target.value}))}
            placeholder="Search by outcome, integration, or trigger"
            className="min-w-0 flex-1 bg-transparent text-sm text-fd-foreground outline-none placeholder:text-fd-muted-foreground"
          />
        </div>

        {hasFilters ? (
          <div className="flex flex-wrap items-center gap-inline">
            <p aria-live="polite" className="text-sm text-fd-muted-foreground">
              {filtered.length} {filtered.length === 1 ? 'example' : 'examples'}
            </p>
            {filters.integrations.map((icon) => (
              <FilterChip
                key={icon}
                label={templateIconLabels[icon]}
                onRemove={() =>
                  setFilters((current) => ({
                    ...current,
                    integrations: current.integrations.filter((value) => value !== icon),
                  }))
                }
              />
            ))}
            {filters.groups.map((group) => (
              <FilterChip
                key={group}
                label={templateGroupLabels[group]}
                onRemove={() =>
                  setFilters((current) => ({
                    ...current,
                    groups: current.groups.filter((value) => value !== group),
                  }))
                }
              />
            ))}
          </div>
        ) : null}

        <Results
          templates={filtered}
          grouped={!hasFilters}
          onClear={() => setFilters(emptyFilters)}
        />
      </div>

      <aside
        aria-label="Filter examples"
        className="flex flex-col gap-section border-t border-fd-border pt-panel lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24 lg:self-start lg:border-t-0 lg:border-l lg:pt-0 lg:px-frame"
      >
        <Facet
          legend="Integrations"
          values={integrations}
          selected={filters.integrations}
          count={(icon) => filterTemplates(templates, {...filters, integrations: [icon]}).length}
          render={(icon) => (
            <>
              <TemplateIcon icon={icon} className="size-4 text-fd-muted-foreground" />
              {templateIconLabels[icon]}
            </>
          )}
          onToggle={(icon) =>
            setFilters((current) => ({
              ...current,
              integrations: toggle(current.integrations, icon),
            }))
          }
        />
        <Facet
          legend="Category"
          values={TEMPLATE_GROUPS}
          selected={filters.groups}
          count={(group) => filterTemplates(templates, {...filters, groups: [group]}).length}
          render={(group) => templateGroupLabels[group]}
          onToggle={(group) =>
            setFilters((current) => ({...current, groups: toggle(current.groups, group)}))
          }
        />
      </aside>
    </section>
  );
}

function Results({
  templates,
  grouped,
  onClear,
}: {
  templates: TemplateCatalogEntry[];
  grouped: boolean;
  onClear: () => void;
}) {
  if (templates.length === 0)
    return (
      <div className="flex flex-col items-center gap-inline rounded-lg border border-dashed border-fd-border p-panel text-center">
        <p className="text-sm font-medium text-fd-foreground">No examples match</p>
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium text-fd-primary hover:underline"
        >
          Clear filters
        </button>
      </div>
    );
  if (!grouped) return <TemplateGrid templates={templates} />;
  return TEMPLATE_GROUPS.map((group) => {
    const inGroup = templates.filter((template) => template.group === group);
    if (inGroup.length === 0) return null;
    return (
      <div key={group} className="flex flex-col gap-group">
        <h2 className="text-sm font-medium text-fd-muted-foreground">
          {templateGroupLabels[group]}
        </h2>
        <TemplateGrid templates={inGroup} />
      </div>
    );
  });
}

function TemplateGrid({templates}: {templates: TemplateCatalogEntry[]}) {
  return (
    <ul className="grid gap-group sm:grid-cols-2">
      {templates.map((template) => (
        <li key={template.id}>
          <TemplateCard template={template} />
        </li>
      ))}
    </ul>
  );
}

function TemplateCard({template}: {template: TemplateCatalogEntry}) {
  return (
    <Link
      href={template.href}
      className="group flex h-full flex-col gap-group rounded-lg border border-fd-border bg-fd-card p-panel-compact text-fd-foreground outline-none transition-colors hover:border-fd-primary/40 hover:bg-fd-accent/40 focus-visible:ring-2 focus-visible:ring-fd-ring"
    >
      <span className="flex flex-col gap-tight">
        <span className="font-semibold leading-snug group-hover:underline">{template.title}</span>
        <span className="line-clamp-2 text-sm text-fd-muted-foreground">{template.summary}</span>
      </span>
      <span className="mt-auto flex flex-col gap-inline">
        <span className="flex items-center gap-tight text-xs text-fd-muted-foreground">
          <Zap aria-hidden="true" className="size-3.5 shrink-0" />
          {template.starts}
        </span>
        <RoleIcons template={template} />
      </span>
    </Link>
  );
}

export function RoleIcons({template}: {template: TemplateCatalogEntry}) {
  return (
    <span className="flex items-center gap-cluster">
      {template.roles.map((role) => (
        <span
          key={role.role}
          title={
            role.optional
              ? `${role.providers.map((p) => templateIconLabels[p]).join(' or ')} (optional)`
              : role.providers.map((p) => templateIconLabels[p]).join(' or ')
          }
          className={`flex items-center gap-tight ${
            role.optional ? 'text-fd-muted-foreground/50' : 'text-fd-foreground'
          }`}
        >
          {role.providers.map((provider) => (
            <TemplateIcon key={provider} icon={provider} labelled className="size-4" />
          ))}
        </span>
      ))}
    </span>
  );
}

function Facet<Value extends string>({
  legend,
  values,
  selected,
  count,
  render,
  onToggle,
}: {
  legend: string;
  values: readonly Value[];
  selected: readonly Value[];
  count: (value: Value) => number;
  render: (value: Value) => React.ReactNode;
  onToggle: (value: Value) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-inline">
      <legend className="pb-inline text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
        {legend}
      </legend>
      {values.map((value) => {
        const n = count(value);
        return (
          <label
            key={value}
            className={`flex cursor-pointer items-center gap-inline py-0.5 text-sm ${
              n === 0 ? 'text-fd-muted-foreground' : 'text-fd-foreground'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value)}
              className="size-4 shrink-0 rounded border-fd-border accent-fd-primary"
            />
            <span className="flex items-center gap-inline">{render(value)}</span>
            <span className="ml-auto text-xs tabular-nums text-fd-muted-foreground">{n}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function FilterChip({label, onRemove}: {label: string; onRemove: () => void}) {
  return (
    <span className="inline-flex items-center gap-tight rounded-full border border-fd-border bg-fd-muted p-tight text-xs text-fd-foreground">
      {label}
      <button type="button" aria-label={`Remove ${label} filter`} onClick={onRemove}>
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

function filterTemplates(templates: TemplateCatalogEntry[], filters: Filters) {
  const query = filters.query.trim().toLowerCase();
  return templates.filter((template) => {
    const integrations = templateIntegrations(template);
    if (
      filters.integrations.length > 0 &&
      !filters.integrations.some((icon) => integrations.includes(icon))
    )
      return false;
    if (filters.groups.length > 0 && !filters.groups.includes(template.group)) return false;
    if (query.length === 0) return true;
    return [
      template.title,
      template.summary,
      template.starts,
      ...integrations.map((icon) => templateIconLabels[icon]),
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

function toggle<Value>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
