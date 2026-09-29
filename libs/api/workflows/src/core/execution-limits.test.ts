import {describe, expect, test} from '@shipfox/vitest/vi';
import {resolveJobExecutionDuration} from './execution-limits.js';

const notice = {
  reason: 'workspace-limit',
  message: 'Add credits for longer jobs',
};

describe('resolveJobExecutionDuration', () => {
  test('caps an installation claim in enforce mode', () => {
    const result = resolveJobExecutionDuration({
      requestedMs: 3 * 60 * 60 * 1000,
      provisionerScope: 'installation',
      limits: {
        maxExecutionMs: 60 * 60 * 1000,
        defaultExecutionMs: 60 * 60 * 1000,
        mode: 'enforce',
        capNotice: notice,
      },
    });

    expect(result).toEqual({
      requestedMs: 3 * 60 * 60 * 1000,
      effectiveMs: 60 * 60 * 1000,
      outcome: 'capped',
      capped: true,
      notice,
    });
  });

  test('keeps the requested duration for workspace and manual claims', () => {
    const limits = {
      maxExecutionMs: 60 * 60 * 1000,
      defaultExecutionMs: 60 * 60 * 1000,
      mode: 'enforce' as const,
      capNotice: notice,
    };

    expect(
      resolveJobExecutionDuration({
        requestedMs: 3 * 60 * 60 * 1000,
        provisionerScope: 'workspace',
        limits,
      }),
    ).toMatchObject({effectiveMs: 3 * 60 * 60 * 1000, outcome: 'within', capped: false});
    expect(
      resolveJobExecutionDuration({
        requestedMs: 3 * 60 * 60 * 1000,
        provisionerScope: null,
        limits,
      }),
    ).toMatchObject({effectiveMs: 3 * 60 * 60 * 1000, outcome: 'within', capped: false});
  });

  test('uses the policy default only for installation claims', () => {
    const limits = {
      maxExecutionMs: 4 * 60 * 60 * 1000,
      defaultExecutionMs: 60 * 60 * 1000,
      mode: 'enforce' as const,
    };

    expect(
      resolveJobExecutionDuration({requestedMs: null, provisionerScope: 'installation', limits}),
    ).toMatchObject({effectiveMs: 60 * 60 * 1000, outcome: 'within'});
    expect(
      resolveJobExecutionDuration({requestedMs: null, provisionerScope: 'workspace', limits}),
    ).toMatchObject({effectiveMs: 6 * 60 * 60 * 1000, outcome: 'within'});
  });

  test('observes a cap without changing the requested deadline', () => {
    const result = resolveJobExecutionDuration({
      requestedMs: 3 * 60 * 60 * 1000,
      provisionerScope: 'installation',
      limits: {
        maxExecutionMs: 60 * 60 * 1000,
        defaultExecutionMs: 60 * 60 * 1000,
        mode: 'observe',
        capNotice: notice,
      },
    });

    expect(result).toEqual({
      requestedMs: 3 * 60 * 60 * 1000,
      effectiveMs: 3 * 60 * 60 * 1000,
      outcome: 'would_cap',
      capped: false,
      notice: null,
    });
  });
});
