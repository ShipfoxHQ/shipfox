import type {HeartbeatStepLeaseTokenDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {LeaseTokenSource} from '@shipfox/runner-protocol';
import type {KyInstance} from 'ky';

/** What one running step uses for its step-scoped API calls. */
export interface StepLease {
  /** Sends the step's latest token on every request. */
  readonly client: KyInstance;
  readonly token: () => string;
  /** Stops renewing the step's token and drops it from redaction. */
  release(): void;
}

export interface StepLeases {
  hold(params: {stepId: string; attempt: number; leaseToken: string}): StepLease;
}

interface HeldToken {
  stepId: string;
  attempt: number;
  current: string;
  previous: string | undefined;
}

/**
 * The step-scoped lease tokens of the running steps. Each step keeps the token `next` minted for
 * it, replaced by each heartbeat renewal. The previous generation stays in redaction until the
 * step ends, since output written just before a renewal can still carry it.
 */
export class StepLeaseTokens implements StepLeases {
  private readonly held = new Map<string, HeldToken>();

  constructor(
    private readonly options: {
      createClient: (leaseToken: LeaseTokenSource) => KyInstance;
      onChange: () => void;
    },
  ) {}

  hold(params: {stepId: string; attempt: number; leaseToken: string}): StepLease {
    const key = stepLeaseKey(params.stepId, params.attempt);
    const held: HeldToken = {
      stepId: params.stepId,
      attempt: params.attempt,
      current: params.leaseToken,
      previous: undefined,
    };
    this.held.set(key, held);
    this.options.onChange();
    const token = () => held.current;
    return {
      client: this.options.createClient(token),
      token,
      release: () => {
        if (this.held.get(key) !== held) return;
        this.held.delete(key);
        this.options.onChange();
      },
    };
  }

  /** The current token of every running step, for the heartbeat to renew. */
  tokens(): string[] {
    return [...this.held.values()].map((held) => held.current);
  }

  /**
   * Adopts heartbeat renewals and returns whether a held token changed. A renewal for a step that
   * already ended is ignored. The caller rebuilds redaction, once for the whole heartbeat.
   */
  renew(params: {
    sent: readonly string[];
    renewed: readonly HeartbeatStepLeaseTokenDto[];
  }): boolean {
    let changed = false;
    const renewedKeys = new Set<string>();
    for (const renewal of params.renewed) {
      const key = stepLeaseKey(renewal.step_id, renewal.attempt);
      renewedKeys.add(key);
      const held = this.held.get(key);
      if (held === undefined || held.current === renewal.lease_token) continue;
      held.previous = held.current;
      held.current = renewal.lease_token;
      changed = true;
    }
    this.warnAboutDroppedTokens(new Set(params.sent), renewedKeys);
    return changed;
  }

  // The step keeps its token until it expires, then its step-scoped calls fail with 401s.
  private warnAboutDroppedTokens(sent: ReadonlySet<string>, renewedKeys: ReadonlySet<string>) {
    for (const [key, held] of this.held) {
      if (!sent.has(held.current) || renewedKeys.has(key)) continue;
      logger().warn(
        {stepId: held.stepId, attempt: held.attempt},
        'Heartbeat did not renew the step lease token',
      );
    }
  }

  secrets(): string[] {
    return [...this.held.values()].flatMap((held) =>
      held.previous === undefined ? [held.current] : [held.current, held.previous],
    );
  }
}

function stepLeaseKey(stepId: string, attempt: number): string {
  return `${stepId}:${attempt}`;
}
