import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  CLIENT_BASE_URL: str({
    desc: 'Base URL of the client app. Used to build links in workspace invitation emails.',
    default: 'http://localhost:5173',
  }),
});
