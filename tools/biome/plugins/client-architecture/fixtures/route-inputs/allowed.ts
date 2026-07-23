import {useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';

export function AllowedRouteInputs() {
  const params = useRouteParams((input) => input);
  const search = useRouteSearch((input) => input);
  return {params, search};
}
