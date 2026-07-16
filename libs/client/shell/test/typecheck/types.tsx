import {Link, useSearch} from '@tanstack/react-router';
import './shipfox-app.gen.js';

export function CompositionTypes(): React.ReactNode {
  const search = useSearch({from: '/workspaces/$wid/projects/$pid/overview'});
  const tab: 'activity' | 'overview' = search.tab;

  return (
    <>
      <Link to="/workspaces/$wid/insights" params={{wid: 'workspace'}}>
        Insights
      </Link>
      <span>{tab}</span>
      {/* @ts-expect-error The generated route tree rejects unknown paths. */}
      <Link to="/not-a-route">Missing route</Link>
    </>
  );
}
