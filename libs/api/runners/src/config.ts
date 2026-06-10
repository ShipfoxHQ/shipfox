import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  // Mirrors AUTH_JWT_SECRET handling: required, no default — fail fast on misconfig.
  RUNNERS_JOB_LEASE_TOKEN_SECRET: str(),
  // TTL must outlast a job (JOB_MAX_DURATION is 60 minutes) plus margin.
  RUNNERS_JOB_LEASE_TOKEN_EXPIRES_IN: str({default: '90m'}),
});
