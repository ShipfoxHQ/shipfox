import type {TriggerEventOutcomeDto} from '@shipfox/api-triggers-dto';

/** The `--tag-*` color family the status `Dot` draws from (a subset of its variants). */
export type TriggerOutcomeColor = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface TriggerOutcomeVisual {
  dot: TriggerOutcomeColor;
  /** Pulse the dot while evaluation is in flight (DESIGN.md §10 in-progress state). */
  ripple: boolean;
  label: string;
}

// Single source of truth for trigger-event status visuals (DESIGN.md §9):
// received (neutral, pulsing) → routed (blue) → discarded (neutral) / failed (error).
// `errored` is a terminal event-level outcome (written by markReceivedEventErrored); it gets
// the same error treatment as `failed` and is folded into the Failed filter chip.
const VISUALS: Record<TriggerEventOutcomeDto, TriggerOutcomeVisual> = {
  received: {dot: 'neutral', ripple: true, label: 'Received'},
  routed: {dot: 'info', ripple: false, label: 'Routed'},
  discarded: {dot: 'neutral', ripple: false, label: 'Discarded'},
  failed: {dot: 'error', ripple: false, label: 'Failed'},
  errored: {dot: 'error', ripple: false, label: 'Errored'},
};

export function getTriggerOutcomeVisual(outcome: TriggerEventOutcomeDto): TriggerOutcomeVisual {
  return VISUALS[outcome];
}
