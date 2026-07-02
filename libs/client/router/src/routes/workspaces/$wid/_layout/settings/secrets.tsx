import {SecretsSettingsPage} from '@shipfox/client-workspace-settings';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/settings/secrets')({
  component: SecretsSettingsPage,
});
