import {SentryCallbackPage} from '@shipfox/client-integrations';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/integrations/sentry/callback')({
  component: SentryCallbackPage,
});
