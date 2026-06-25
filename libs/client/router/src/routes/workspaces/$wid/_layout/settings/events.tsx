import {validateTriggerEventsSearch} from '@shipfox/client-triggers';
import {EventsSettingsPage} from '@shipfox/client-workspace-settings';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/settings/events')({
  validateSearch: validateTriggerEventsSearch,
  component: EventsSettingsPage,
});
