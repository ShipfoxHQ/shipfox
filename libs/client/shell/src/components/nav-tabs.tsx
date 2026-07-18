import {Link, useParams} from '@tanstack/react-router';
import {useReducedMotion} from 'framer-motion';
import type {NavTabEntry} from '#contract.js';

export function NavTabs({
  entries,
  scope,
}: {
  entries: readonly NavTabEntry[];
  scope: NavTabEntry['scope'];
}) {
  const params = useParams({strict: false}) as {wid?: string; pid?: string};
  const reduced = useReducedMotion();
  const tabs = entries.filter((entry) => entry.scope === scope);
  const tabClassName = `h-40 inline-flex items-center px-4 text-sm font-medium transition-colors ${reduced ? '' : 'transition-[border-color]'}`;
  const activeProps = {
    className: 'border-b-2 border-border-highlights-interactive text-foreground-neutral-base',
    'aria-selected': 'true' as const,
  };
  const inactiveProps = {
    className: 'border-b-2 border-transparent text-foreground-neutral-muted',
    'aria-selected': 'false' as const,
  };

  return (
    <div
      role="tablist"
      aria-label={`${scope === 'project' ? 'Project' : 'Workspace'} sections`}
      className="sticky top-56 z-20 h-40 px-16 flex items-end gap-12 bg-background-subtle-base border-b border-border-neutral-base"
    >
      {tabs.map((entry) => (
        <Link
          key={entry.id}
          to={entry.to as never}
          params={params as never}
          role="tab"
          activeOptions={{exact: entry.exact ?? false}}
          activeProps={activeProps}
          inactiveProps={inactiveProps}
          className={tabClassName}
        >
          {entry.label}
        </Link>
      ))}
    </div>
  );
}
