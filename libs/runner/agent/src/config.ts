import {bool, createConfig, str} from '@shipfox/config';
import {type EgressPolicy, parseEgressHostDenylist} from '@shipfox/node-egress-guard';

export const config = createConfig({
  AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS: bool({
    desc: 'Allows custom model providers to use private, loopback, link-local, metadata, and .internal network targets. Keep this true for local development and self-hosted private networks. Set it to false on cloud instances.',
    default: true,
  }),
  AGENT_CUSTOM_PROVIDER_HOST_DENYLIST: str({
    desc: 'Comma-separated hosts and IP ranges that custom model providers may not call. Accepts exact hosts, suffix patterns such as .internal.example or *.internal.example, IP literals, and CIDR blocks such as 10.0.0.0/8.',
    default: '',
  }),
});

export function runnerEgressPolicy(): EgressPolicy {
  return {
    allowPrivateNetworks: config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS,
    hostDenylist: parseEgressHostDenylist(config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST),
  };
}
