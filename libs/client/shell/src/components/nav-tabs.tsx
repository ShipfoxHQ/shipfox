import {Link, useParams} from '@tanstack/react-router';
import type {NavTabEntry} from '#contract.js';

export function NavTabs({
  entries,
  scope,
}: {
  entries: readonly NavTabEntry[];
  scope: NavTabEntry['scope'];
}) {
  const params = useParams({strict: false}) as {wid?: string; pid?: string};
  const tabs = entries.filter((entry) => entry.scope === scope);
  if (!tabs.length) return null;
  const activeProps = {
    className: 'border-b-2 border-border-highlights-interactive',
    'aria-selected': true,
  };
  const inactiveProps = {className: 'border-b-2 border-transparent', 'aria-selected': false};

  return (
    <div role="tablist" aria-label={`${scope === 'project' ? 'Project' : 'Workspace'} sections`}>
      {tabs.map((entry) => (
        <Link
          key={entry.id}
          to={entry.to as never}
          params={params as never}
          role="tab"
          activeOptions={{exact: entry.exact ?? false}}
          activeProps={activeProps}
          inactiveProps={inactiveProps}
        >
          {entry.label}
        </Link>
      ))}
    </div>
  );
}
