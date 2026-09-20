import {WORKSPACES_MAX_LIST_LIMIT} from '@shipfox/api-workspaces-dto';
import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  CLIENT_BASE_URL: str({
    desc: 'Base URL of the client app. Used to build links in workspace invitation emails.',
    default: 'http://localhost:5173',
  }),
  WORKSPACES_MAX_PER_WORKSPACE: num({
    desc: 'Maximum number of members and open invitations allowed in one workspace. The value must be between 1 and the complete members list limit.',
    default: 10000,
  }),
});

if (config.WORKSPACES_MAX_PER_WORKSPACE < 1) {
  throw new Error('WORKSPACES_MAX_PER_WORKSPACE must be greater than 0.');
}
if (config.WORKSPACES_MAX_PER_WORKSPACE > WORKSPACES_MAX_LIST_LIMIT) {
  throw new Error(
    `WORKSPACES_MAX_PER_WORKSPACE (${config.WORKSPACES_MAX_PER_WORKSPACE}) cannot exceed WORKSPACES_MAX_LIST_LIMIT (${WORKSPACES_MAX_LIST_LIMIT}).`,
  );
}
