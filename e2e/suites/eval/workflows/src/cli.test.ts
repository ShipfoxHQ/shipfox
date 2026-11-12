import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseEvalArgs} from './cli.js';

const onboardingOnlyPattern = /onboarding only/u;
const agentModelPattern = /onboarding and shippy only/u;
const workersPattern = /--workers applies to scripted and live template and shippy runs only/u;
const positivePattern = /--workers must be a positive integer/u;
const compilePattern = /compile applies to --suite templates and contracts only/u;

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
    ).toThrow(agentModelPattern);
  });

  it('takes an agent model for the shippy suite, but no simulator model', () => {
    expect(parseEvalArgs(['--suite', 'shippy', '--agent-model', 'gpt-6-luna']).agentModel).toBe(
      'gpt-6-luna',
    );
    expect(() => parseEvalArgs(['--suite', 'shippy', '--simulator-model', 'x'])).toThrow(
      onboardingOnlyPattern,
    );
  });
});

describe('workers option', () => {
  it('reads the number of workers', () => {
    expect(parseEvalArgs(['--workers', '2']).workers).toBe(2);
  });

  it('defaults to 4 workers for scripted and live template runs', () => {
    expect(parseEvalArgs([]).workers).toBe(4);
    expect(parseEvalArgs(['--mode', 'live']).workers).toBe(4);
  });

  it('spreads shippy runs over workers like template runs', () => {
    expect(parseEvalArgs(['--suite', 'shippy']).workers).toBe(4);
    expect(parseEvalArgs(['--suite', 'shippy', '--mode', 'live', '--workers', '2']).workers).toBe(
      2,
    );
    expect(() => parseEvalArgs(['--suite', 'shippy', '--mode', 'compile'])).toThrow(compilePattern);
  });

  it('sets no workers for the onboarding suite and compile mode', () => {
    expect(parseEvalArgs(['--suite', 'onboarding']).workers).toBeUndefined();
    expect(parseEvalArgs(['--mode', 'compile']).workers).toBeUndefined();
  });

  it('rejects a count that is not a positive integer', () => {
    expect(() => parseEvalArgs(['--workers', '0'])).toThrow(positivePattern);
    expect(() => parseEvalArgs(['--workers', 'many'])).toThrow(positivePattern);
  });

  it('rejects workers for the onboarding suite and compile mode', () => {
    expect(() => parseEvalArgs(['--suite', 'onboarding', '--workers', '2'])).toThrow(
      workersPattern,
    );
    expect(() => parseEvalArgs(['--mode', 'compile', '--workers', '2'])).toThrow(workersPattern);
  });
});
