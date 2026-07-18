import {defineRoute} from '@shipfox/client-shell/runtime';
import {redirect} from '@tanstack/react-router';

export default defineRoute({
  beforeLoad: ({params}: {params: {wid: string}}) => {
    throw redirect({to: '/workspaces/$wid/settings/members', params: {wid: params.wid}});
  },
});
