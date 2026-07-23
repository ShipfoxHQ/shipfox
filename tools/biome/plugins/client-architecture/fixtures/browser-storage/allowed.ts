import {createTypedBrowserStorage} from '@shipfox/client-ui';

export const allowedStorage = createTypedBrowserStorage(() => undefined, {
  key: 'fixture.allowed',
  lifetime: 'session',
  principalScope: 'global',
  serialize: (value: string) => value,
  parse: (value: string) => value,
});
