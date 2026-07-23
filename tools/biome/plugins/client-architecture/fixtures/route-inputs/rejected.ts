import {useParams, useSearch as readSearch} from '@tanstack/react-router';
import * as router from '@tanstack/react-router';

export function RejectedRouteInputs() {
  const search = readSearch({strict: false});
  const params = useParams({strict: false});
  const namespacedParams = router.useParams({strict: false});
  return {search, params, namespacedParams};
}
