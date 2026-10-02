import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseEvalArgs} from './cli.js';

const onboardingOnlyPattern = /onboarding only/u;

describe('model options', () => {
  it('reads the onboarding agent and simulator models', () => {
    const options = parseEvalArgs([
      '--suite',
      'onboarding',
      '--agent-model',
      'claude-opus-5-5',
      '--simulator-model',
      'claude-haiku-4-5-20251001',
    ]);

    expect(options.agentModel).toBe('claude-opus-5-5');
    expect(options.simulatorModel).toBe('claude-haiku-4-5-20251001');
  });

  it('rejects a model for the templates suite, which uses each template anchor model', () => {
    expect(() =>
      parseEvalArgs(['--suite', 'templates', '--agent-model', 'claude-opus-5-5']),
    ).toThrow(onboardingOnlyPattern);
  });
});
