import {getRouteApi, Link, useSearch} from '@tanstack/react-router';
import './shipfox-app.gen.js';

export function CompositionTypes(): React.ReactNode {
  const search = useSearch({from: '/workspaces/$wid/projects/$pid/overview'});
  const tab: 'activity' | 'overview' = search.tab;

  getRouteApi('/workspaces/$wid/projects/$pid/overview');

  // @ts-expect-error The generated route tree rejects unknown route ids.
  getRouteApi('/not-a-route');

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
