import {createContext, type ReactNode, useContext, useEffect, useState} from 'react';

/**
 * Shared ticker for live job durations on the graph.
 *
 * One `setInterval` for the whole graph (mounted via `JobDurationTickerProvider`),
 * shared by every live `JobDurationLabel`. Modelled on `RelativeTimeProvider`
 * (react-ui). It ticks every second so a job timer advances smoothly; under
 * `prefers-reduced-motion` it slows to a calm 10s cadence rather than stopping —
 * the value still advances (never freezes between the 4s data polls), it just
 * doesn't change every second.
 *
 * Pauses while the tab is hidden. Reacts to a live `prefers-reduced-motion`
 * toggle by re-arming the interval at the new cadence.
 */

const DurationTickContext = createContext<number>(0);

const TICK_MS = 1_000;
const REDUCED_MOTION_TICK_MS = 10_000;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function JobDurationTickerProvider({children}: {children: ReactNode}) {
  const [tick, setTick] = useState(0);
  const intervalMs = usePrefersReducedMotion() ? REDUCED_MOTION_TICK_MS : TICK_MS;

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let interval: number | undefined;

    const start = () => {
      if (interval !== undefined) return;
      interval = window.setInterval(() => {
        setTick((current) => current + 1);
      }, intervalMs);
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
  }, [intervalMs]);

  return <DurationTickContext.Provider value={tick}>{children}</DurationTickContext.Provider>;
}

export function useDurationTick(): number {
  return useContext(DurationTickContext);
}
