import type {ReactNode} from 'react';
import {useMediaQuery} from '#hooks/useMediaQuery.js';
import {formatTimestamp} from '#utils/datetime.js';
import {formatRelative} from '#utils/relative-time.js';
import {TimeTickerProvider, useTimeTick} from '../time-ticker/index.js';
import {Tooltip, TooltipContent, TooltipTrigger} from '../tooltip/index.js';

const TICK_MS = 30_000;

export function RelativeTimeProvider({children}: {children: ReactNode}) {
  return <TimeTickerProvider intervalMs={TICK_MS}>{children}</TimeTickerProvider>;
}

/**
 * Renders a short relative time string ("12s ago", "3m ago", "2h ago").
 *
 * Subscribes to the page-level ticker so all instances re-render together.
 * Hovering reveals the absolute timestamp via `formatTimestamp` in a
 * `<Tooltip>`. The string respects users with `prefers-reduced-motion`
 * by quantizing sub-minute updates to the nearest minute, so the visual
 * stays still for those users instead of ticking every 30s.
 */
export function RelativeTime({value, className}: {value: string; className?: string}) {
  useTimeTick();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const display = formatRelative(value, {reducedMotion});

  // Skip the Tooltip entirely for unparseable input so consumers see a
  // clean empty render instead of a tooltip exposing a thrown Intl call.
  if (!display) return <span className={className} />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{display}</span>
      </TooltipTrigger>
      <TooltipContent>{formatTimestamp(value)}</TooltipContent>
    </Tooltip>
  );
}
