import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  TOKEN_ENVIRONMENT: str({
    desc: 'Optional label added to generated token prefixes to separate environments, such as staging. When set, only tokens that carry the same label pass validation.',
    default: undefined,
  }),
});
