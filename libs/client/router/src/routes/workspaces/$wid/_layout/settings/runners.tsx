import {RunnersSettingsPage} from '@shipfox/client-workspace-settings';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/settings/runners')({
  component: RunnersSettingsPage,
});
