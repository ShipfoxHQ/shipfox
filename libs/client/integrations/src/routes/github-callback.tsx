import {defineRoute, useRouteSearch} from '@shipfox/client-shell/runtime';
import {parseGithubCallbackSearch} from '#github-callback.js';
import {GithubCallbackPage} from '#pages/github-callback-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: parseGithubCallbackSearch,
  component: GithubCallbackRoute,
});

function GithubCallbackRoute() {
  const search = useRouteSearch(parseGithubCallbackSearch);
  return <GithubCallbackPage search={search} />;
}
