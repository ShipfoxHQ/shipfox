import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/')({
  beforeLoad: ({params}) => {
    throw redirect({
      to: '/workspaces/$wid/projects/$pid/runs',
      params: {wid: params.wid, pid: params.pid},
    });
  },
});
