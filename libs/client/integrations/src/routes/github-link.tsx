import {defineRoute} from '@shipfox/client-shell/runtime';
import {GithubLinkPage} from '#pages/github-link-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: GithubLinkPage,
});
