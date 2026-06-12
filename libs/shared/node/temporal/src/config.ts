import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  TEMPORAL_ADDRESS: str({
    desc: 'Address of the Temporal server in host:port form.',
    default: 'localhost:7233',
  }),
  TEMPORAL_NAMESPACE: str({
    desc: 'Temporal namespace that workflows and activities run in.',
    default: 'default',
  }),
  TEMPORAL_TASK_QUEUE: str({
    desc: 'Task queue that workers and clients share. Workers and clients must use the same value.',
    default: 'shipfox',
  }),
});
