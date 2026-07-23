import {expect, it} from '@shipfox/vitest/vi';
import {values} from 'fixture-workspace-package';

it('loads compiled package output when workspace-source is disabled', () => {
  expect(values).toEqual(['dist-db', 'dist-component']);
});
