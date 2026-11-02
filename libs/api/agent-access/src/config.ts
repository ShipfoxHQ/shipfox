import {bool, createConfig} from '@shipfox/config';

export const config = createConfig({
  AGENT_ACCESS_ADMIN_MCP_ENABLED: bool({
    desc: 'Whether the API serves the admin MCP endpoint at POST /mcp/admin. Defaults to false. The endpoint lets administrators find users and open impersonation windows, and it shares the OAuth resource of /mcp. Every call still requires an administrator role. Enable it only when AUTH_IMPERSONATION_ENABLED is true.',
    default: false,
  }),
});
