import {cn} from '#utils/cn.js';

export type DotVariant = 'neutral' | 'info' | 'feature' | 'success' | 'warning' | 'error';

/**
 * Drives both the dot and its rings via `currentColor`. Variants mirror the
 * `Badge` set and map to the same `--tag-*-text` family, so a dot matches the
 * badge/status pill it stands in for. `neutral` is the muted default.
 */
const colorByVariant: Record<DotVariant, string> = {
  neutral: 'text-tag-neutral-text',
  info: 'text-tag-blue-text',
  feature: 'text-tag-purple-text',
  success: 'text-tag-success-text',
  warning: 'text-tag-warning-text',
  error: 'text-tag-error-text',
};

export interface DotProps {
  /** Color variant. Defaults to `neutral` (muted). */
  variant?: DotVariant;
  /**
   * Emit fading concentric rings that grow outward from the dot, signalling a
   * live/loading state. Off by default (a static dot). The rings honor
   * `prefers-reduced-motion`, so users who opt out always see the static dot.
   */
  ripple?: boolean;
  /** Size and spacing overrides. */
  className?: string;
}

/**
 * A small filled dot for dense status/presence affordances. Muted by default;
 * set `ripple` to radiate concentric rings for active or loading states.
 */
export function Dot({variant = 'neutral', ripple = false, className}: DotProps) {
  return (
    <span
      className={cn('relative inline-flex size-6 shrink-0', colorByVariant[variant], className)}
      aria-hidden="true"
    >
      {ripple ? (
        <>
          <span className="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
          <span className="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping [animation-delay:-500ms]" />
        </>
      ) : null}
      <span className="relative size-full rounded-full bg-current" />
    </span>
  );
}
