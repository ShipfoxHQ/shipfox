import {defineRoute} from '@shipfox/client-shell/runtime';

function OverriddenInsights() {
  return <h1>Overridden insights</h1>;
}

export default defineRoute({
  component: OverriddenInsights,
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === 'compact' ? ('compact' as const) : ('full' as const),
  }),
});
