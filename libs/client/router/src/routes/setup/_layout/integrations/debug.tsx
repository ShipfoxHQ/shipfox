import {DebugInstallPage} from '@shipfox/client-integrations';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/_layout/integrations/debug')({
  component: DebugInstallPage,
});
