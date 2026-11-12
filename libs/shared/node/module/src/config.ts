import {bool, createConfig} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_STRICT_PACKAGE_COPIES: bool({
    desc: 'Fails startup when a package that keeps its state with @shipfox/node-process-state is installed more than once, whether or not the copies share state. Set to true in test and CI environments to catch duplicate installs before they reach production.',
    default: false,
  }),
});
