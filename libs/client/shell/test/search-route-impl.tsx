import {defineRoute} from '@shipfox/client-shell';

export default defineRoute({
  component: () => <div>Search route</div>,
  validateSearch: (search: Record<string, unknown>) =>
    ({tab: search.tab === 'activity' ? 'activity' : 'overview'}) as const,
});
