import {AgentProvidersSettingsPage} from '@shipfox/client-workspace-settings';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/settings/agent-providers')({
  component: AgentProvidersSettingsPage,
});
