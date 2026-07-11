import {LinearCallbackPage} from '@shipfox/client-integrations';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/integrations/linear/callback')({
  component: LinearCallbackPage,
});
