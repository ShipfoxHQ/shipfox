import {cn, Dot, type DotVariant, Icon, type IconName} from '@shipfox/react-ui';
import {getWorkflowStatusVisual, type WorkflowStatus} from './status-visuals.js';

// Status glyphs use the same saturated accent tokens as IconBadge/StatusBadge.
const toneByVariant: Record<DotVariant, string> = {
  neutral: 'text-tag-neutral-icon',
  info: 'text-tag-blue-icon',
  feature: 'text-tag-purple-icon',
  success: 'text-tag-success-icon',
  warning: 'text-tag-warning-icon',
  error: 'text-tag-error-icon',
};

// The source glyphs fill their viewBoxes by different amounts (the solid discs ~90-95%,
// forbid2Fill ~83%, the dotted ring ~75%), so one numeric size renders visibly different
// diameters. These multipliers land every disc/ring at the same optical diameter as the
// running Dot.
const glyphScale: Partial<Record<IconName, number>> = {
  checkCircleSolid: 1.12,
  xCircleSolid: 1.06,
  forbid2Fill: 1.22,
  circleDottedLine: 1.3,
};

// Fixed layout box shared by the running Dot and the glyph wrapper, so every state occupies
// the same width and the glyphs (plus the text after them) stay aligned down a row list, even
// though the scaled glyph boxes differ. Only the two sizes the app uses are mapped; both are
// literal strings so Tailwind's scanner emits them.
const dotSizeClass: Record<number, string> = {
  12: 'size-12',
  14: 'size-14',
};

export interface WorkflowStatusIconProps {
  status: WorkflowStatus;
  /** Optical diameter in px: 14 in the DAG node and run row, 12 in the run-header pill. */
  size?: number;
  /** Pulsing halo for the running state. Pass false inside the header pill, where the rings would clip. */
  ripple?: boolean;
  className?: string;
}

/** Decorative status glyph. Callers must render the textual status label separately. */
export function WorkflowStatusIcon({
  status,
  size = 14,
  ripple = true,
  className,
}: WorkflowStatusIconProps) {
  const visual = getWorkflowStatusVisual(status);

  if (visual.kind === 'running') {
    return (
      <Dot
        variant="info"
        ripple={ripple}
        className={cn(dotSizeClass[size] ?? 'size-14', className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        dotSizeClass[size] ?? 'size-14',
        toneByVariant[visual.dot],
        visual.kind === 'cancelled' && 'opacity-70',
        className,
      )}
    >
      <Icon name={visual.icon} size={Math.round(size * (glyphScale[visual.icon] ?? 1))} />
    </span>
  );
}
