import type {TriggerEventOutcomeDto} from '@shipfox/api-triggers-dto';

/** The `--tag-*` color family shared by `Dot` and `Badge` (a subset of their variants). */
export type TriggerOutcomeColor = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface TriggerOutcomeVisual {
  dot: TriggerOutcomeColor;
  badge: TriggerOutcomeColor;
  /** Pulse the dot while evaluation is in flight (DESIGN.md §10 in-progress state). */
  ripple: boolean;
  label: string;
}

// Single source of truth for trigger-event status visuals (DESIGN.md §9):
// received (neutral, pulsing) → routed (blue) → discarded (neutral) / failed (error).
// `errored` is a decision-level value that should not surface at the event level, but it
// is in the DTO enum, so it is mapped defensively to the error treatment.
const VISUALS: Record<TriggerEventOutcomeDto, TriggerOutcomeVisual> = {
  received: {dot: 'neutral', badge: 'neutral', ripple: true, label: 'Received'},
  routed: {dot: 'info', badge: 'info', ripple: false, label: 'Routed'},
  discarded: {dot: 'neutral', badge: 'neutral', ripple: false, label: 'Discarded'},
  failed: {dot: 'error', badge: 'error', ripple: false, label: 'Failed'},
  errored: {dot: 'error', badge: 'error', ripple: false, label: 'Errored'},
};

export function getTriggerOutcomeVisual(outcome: TriggerEventOutcomeDto): TriggerOutcomeVisual {
  return VISUALS[outcome];
}
