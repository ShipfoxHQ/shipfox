import {shouldAssertDataTableNavigationContract} from './data-table-runtime.js';

describe('shouldAssertDataTableNavigationContract', () => {
  test.each([
    {buildDevelopment: true, expected: true, nodeEnvironment: undefined},
    {buildDevelopment: false, expected: true, nodeEnvironment: 'development'},
    {buildDevelopment: false, expected: true, nodeEnvironment: 'test'},
    {buildDevelopment: false, expected: false, nodeEnvironment: 'production'},
    {buildDevelopment: undefined, expected: false, nodeEnvironment: undefined},
  ])('returns $expected for buildDevelopment=$buildDevelopment and nodeEnvironment=$nodeEnvironment', ({
    buildDevelopment,
    expected,
    nodeEnvironment,
  }) => {
    expect(shouldAssertDataTableNavigationContract(buildDevelopment, nodeEnvironment)).toBe(
      expected,
    );
  });
});
