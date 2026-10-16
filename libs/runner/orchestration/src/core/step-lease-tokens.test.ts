import {logger} from '@shipfox/node-opentelemetry';
import type {KyInstance} from 'ky';
import {StepLeaseTokens} from '#core/step-lease-tokens.js';

const STEP_ID = '00000000-0000-0000-0000-0000000000a1';
const OTHER_STEP_ID = '00000000-0000-0000-0000-0000000000a2';

function createTokens() {
  const onChange = vi.fn();
  const tokens = new StepLeaseTokens({createClient: () => ({}) as KyInstance, onChange});
  return {tokens, onChange};
}

describe('StepLeaseTokens', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports whether a renewal changed a held token, without rebuilding redaction itself', () => {
    const {tokens, onChange} = createTokens();
    const lease = tokens.hold({stepId: STEP_ID, attempt: 1, leaseToken: 'lease-a'});
    onChange.mockClear();

    const changed = tokens.renew({
      sent: ['lease-a'],
      renewed: [{step_id: STEP_ID, attempt: 1, lease_token: 'lease-b'}],
    });
    const unchanged = tokens.renew({
      sent: ['lease-b'],
      renewed: [{step_id: STEP_ID, attempt: 1, lease_token: 'lease-b'}],
    });

    expect(changed).toBe(true);
    expect(unchanged).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(lease.token()).toBe('lease-b');
    expect(tokens.secrets()).toEqual(['lease-b', 'lease-a']);
  });

  it('warns when the heartbeat drops a token it was sent', () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const {tokens} = createTokens();
    const dropped = tokens.hold({stepId: STEP_ID, attempt: 1, leaseToken: 'lease-a'});
    tokens.hold({stepId: OTHER_STEP_ID, attempt: 2, leaseToken: 'lease-other'});
    // Held after the heartbeat was sent, so the heartbeat could not renew it.
    tokens.hold({stepId: OTHER_STEP_ID, attempt: 3, leaseToken: 'lease-new'});

    tokens.renew({
      sent: ['lease-a', 'lease-other'],
      renewed: [{step_id: OTHER_STEP_ID, attempt: 2, lease_token: 'lease-other-renewed'}],
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {stepId: STEP_ID, attempt: 1},
      'Heartbeat did not renew the step lease token',
    );
    expect(dropped.token()).toBe('lease-a');
  });
});
