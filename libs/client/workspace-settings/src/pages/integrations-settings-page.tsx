import {IntegrationGallery} from '@shipfox/client-integrations';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function IntegrationsSettingsPage() {
  return <WorkspaceSettingsShell>{() => <IntegrationGallery />}</WorkspaceSettingsShell>;
}
