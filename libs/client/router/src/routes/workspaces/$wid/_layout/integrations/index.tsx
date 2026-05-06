import {IntegrationGalleryPage} from '@shipfox/client-integrations';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/integrations/')({
  component: IntegrationGalleryPage,
});
