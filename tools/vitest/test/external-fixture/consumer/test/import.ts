import {expect, it} from '@shipfox/vitest/vi';
import {result as distOnlyResult} from 'fixture-dist-only-package';
import {values} from 'fixture-workspace-package';

it('loads workspace source package imports without dist', () => {
  expect(values).toEqual(['source-db', 'source-component']);
  expect(distOnlyResult).toBe('dist-only-upstream');
});
