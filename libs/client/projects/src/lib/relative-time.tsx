import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui';
import {createContext, type ReactNode, useContext, useEffect, useState} from 'react';
import {formatTimestamp} from './format.js';

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
 * by quantizing sub-minute updates to the nearest minute — the visual
 * stays still for those users instead of ticking every 30s.
 */
export function RelativeTime({value, className}: {value: string; className?: string}) {
  // Subscribe to the provider's tick so this component re-renders on
  // each cycle. Re-reading useContext is intentional; the empty body
  // is a subscription, not dead code.
  useContext(TickContext);
  const reducedMotion = usePrefersReducedMotion();

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

function formatRelative(iso: string, {reducedMotion}: {reducedMotion: boolean}): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  const past = diffMs >= 0;
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) {
    if (reducedMotion) return past ? 'just now' : 'in <1m';
    const sec = Math.max(0, Math.floor(absMs / 1000));
    return past ? `${sec}s ago` : `in ${sec}s`;
  }
  if (absMs < 3_600_000) {
    const min = Math.floor(absMs / 60_000);
    return past ? `${min}m ago` : `in ${min}m`;
  }
  if (absMs < 86_400_000) {
    const hr = Math.floor(absMs / 3_600_000);
    return past ? `${hr}h ago` : `in ${hr}h`;
  }
  const day = Math.floor(absMs / 86_400_000);
  return past ? `${day}d ago` : `in ${day}d`;
}

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefers(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefers(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return prefers;
}
