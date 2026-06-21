import {createContext, type ReactNode, useContext, useEffect, useState} from 'react';
import {useMediaQuery} from '#hooks/useMediaQuery.js';
import {formatTimestamp} from '#utils/datetime.js';
import {formatRelative} from '#utils/relative-time.js';
import {Tooltip, TooltipContent, TooltipTrigger} from '../tooltip/index.js';

/**
 * Shared 30s ticker for `<RelativeTime>` instances on a page.
 *
 * One `setInterval` per page (mounted via `<RelativeTimeProvider>`),
 * shared by every `<RelativeTime>`. Without this, a list of 100 rows
 * would mount 100 independent timers (DESIGN.md §10 live-data rule and
 * basic perf hygiene).
 *
 * The ticker pauses while `document.visibilityState === 'hidden'` and
 * resumes on visibility change, so tab-away doesn't keep timers alive.
 */

const TickContext = createContext<number>(0);

const TICK_MS = 30_000;

export function RelativeTimeProvider({children}: {children: ReactNode}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let interval: number | undefined;

    const start = () => {
      if (interval !== undefined) return;
      interval = window.setInterval(() => {
        setTick((current) => current + 1);
      }, TICK_MS);
    };

    const stop = () => {
      if (interval === undefined) return;
      window.clearInterval(interval);
      interval = undefined;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return <TickContext.Provider value={tick}>{children}</TickContext.Provider>;
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
  // Subscribe to the provider's tick so this component re-renders on
  // each cycle. Re-reading useContext is intentional; the empty body
  // is a subscription, not dead code.
  useContext(TickContext);
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
