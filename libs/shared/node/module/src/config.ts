import {bool, createConfig} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_STRICT_PACKAGE_COPIES: bool({
    desc: 'Fails startup when a package is installed more than once and its copies do not share state. Copies that share state only log a warning. Set to true in test and CI environments to catch duplicate installs before they reach production.',
    default: false,
  }),
});
