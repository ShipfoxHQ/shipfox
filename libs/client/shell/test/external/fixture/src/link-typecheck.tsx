import {Link, useSearch} from '@tanstack/react-router';

export function InsightsLink() {
  const search = useSearch({from: '/workspaces/$wid/insights'});
  return (
    <Link to="/workspaces/$wid/insights" params={{wid: 'workspace'}} search={{view: search.view}}>
      Insights
    </Link>
  );
}
