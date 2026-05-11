import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/settings/')({
  beforeLoad: ({params}) => {
    throw redirect({
      to: '/workspaces/$wid/settings/runners',
      params: {wid: params.wid},
    });
  },
});
