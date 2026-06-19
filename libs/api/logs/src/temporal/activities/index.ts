import {closeAbandonedStreamsActivity} from './close-abandoned-streams.js';

export function createLogsActivities() {
  return {
    closeAbandonedStreamsActivity,
  };
}
