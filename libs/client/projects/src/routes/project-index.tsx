import {defineRoute} from '@shipfox/client-shell/runtime';
import {redirect} from '@tanstack/react-router';

export default defineRoute({
  beforeLoad: ({params}: {params: {wid: string; pid: string}}) => {
    throw redirect({
      to: '/workspaces/$wid/projects/$pid/runs',
      params: {wid: params.wid, pid: params.pid},
    });
  },
});
