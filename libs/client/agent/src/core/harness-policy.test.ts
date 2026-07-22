import {listHarnessDescriptors} from '@shipfox/api-agent-dto';
import {listHarnesses} from './harness-policy.js';

describe('harness policy', () => {
  test('stays aligned with the shared harness compatibility contract', () => {
    expect(listHarnesses()).toEqual(
      listHarnessDescriptors().map(({id, label, description, supportedProviderIds}) => ({
        id,
        label,
        description,
        supportedProviderIds,
      })),
    );
  });
});
