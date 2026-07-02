import {VariablesSettingsPage} from '@shipfox/client-workspace-settings';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/settings/variables')({
  component: VariablesSettingsPage,
});
