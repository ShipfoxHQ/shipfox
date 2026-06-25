import {triggerEventOutcomeSchema} from '@shipfox/api-triggers-dto';
import {getTriggerOutcomeVisual, type TriggerOutcomeColor} from './trigger-outcome.js';

const COLORS: TriggerOutcomeColor[] = ['neutral', 'info', 'success', 'warning', 'error'];

describe.each(triggerEventOutcomeSchema.options)('getTriggerOutcomeVisual "%s"', (outcome) => {
  test('returns a labelled visual with valid tag colors', () => {
    const visual = getTriggerOutcomeVisual(outcome);

    expect(visual.label.length).toBeGreaterThan(0);
    expect(COLORS).toContain(visual.dot);
  });
});

describe('getTriggerOutcomeVisual semantics', () => {
  test('received pulses while terminal states stay solid', () => {
    expect(getTriggerOutcomeVisual('received').ripple).toBe(true);
    for (const outcome of ['routed', 'discarded', 'failed', 'errored'] as const) {
      expect(getTriggerOutcomeVisual(outcome).ripple).toBe(false);
    }
  });

  test('routed is blue and failure states are error', () => {
    expect(getTriggerOutcomeVisual('routed').dot).toBe('info');
    expect(getTriggerOutcomeVisual('failed').dot).toBe('error');
    expect(getTriggerOutcomeVisual('errored').dot).toBe('error');
  });
});
