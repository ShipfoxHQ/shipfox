import {getHarnessDescriptor} from '@shipfox/api-agent-dto';
import {customModelProviderConfig, modelProviderConfig} from '#test/fixtures/model-providers.js';
import {compatibleHarnessIds, isHarnessAvailable} from './harness-availability.js';

describe('harness availability', () => {
  test('marks pi available with any builtin provider config', () => {
    const result = isHarnessAvailable(getHarnessDescriptor('pi'), [
      modelProviderConfig({provider_id: 'openai'}),
    ]);

    expect(result).toBe(true);
  });

  test('marks pi available with only a custom provider config', () => {
    const result = isHarnessAvailable(getHarnessDescriptor('pi'), [customModelProviderConfig()]);

    expect(result).toBe(true);
  });

  test('marks claude available only when Anthropic is configured', () => {
    const openai = isHarnessAvailable(getHarnessDescriptor('claude'), [
      modelProviderConfig({provider_id: 'openai'}),
    ]);
    const anthropic = isHarnessAvailable(getHarnessDescriptor('claude'), [
      modelProviderConfig({provider_id: 'anthropic'}),
    ]);

    expect(openai).toBe(false);
    expect(anthropic).toBe(true);
  });

  test('marks both harnesses unavailable when no providers are configured', () => {
    expect(isHarnessAvailable(getHarnessDescriptor('pi'), [])).toBe(false);
    expect(isHarnessAvailable(getHarnessDescriptor('claude'), [])).toBe(false);
  });

  test('returns compatible harnesses for builtin and custom providers', () => {
    expect(compatibleHarnessIds({isCustom: false, providerId: 'anthropic'})).toEqual([
      'pi',
      'claude',
    ]);
    expect(compatibleHarnessIds({isCustom: false, providerId: 'openai'})).toEqual(['pi']);
    expect(compatibleHarnessIds({isCustom: true, providerId: 'custom-provider'})).toEqual(['pi']);
  });
});
