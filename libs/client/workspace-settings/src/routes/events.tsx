import {defineRoute} from '@shipfox/client-shell/runtime';
import {validateTriggerEventsSearch} from '@shipfox/client-triggers';
import {EventsSettingsPage} from '#pages/events-settings-page.js';
export default defineRoute({
  validateSearch: validateTriggerEventsSearch,
  component: EventsSettingsPage,
});
