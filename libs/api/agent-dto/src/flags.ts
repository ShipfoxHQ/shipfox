import {defineFlags} from '@shipfox/feature-flags';

export const agentFlags = defineFlags({
  'agent-chat': {
    kind: 'boolean',
    default: false,
    client: true,
    desc: 'Shows Shippy, the project chat, in the web client. Evaluated per user and workspace. The conversation routes stay served. FLAG_AGENT_CHAT overrides the provider.',
  },
});
