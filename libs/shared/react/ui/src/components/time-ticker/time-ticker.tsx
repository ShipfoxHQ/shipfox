import {createContext, type ReactNode, useContext, useEffect, useState} from 'react';
import {useMediaQuery} from '#hooks/useMediaQuery.js';

const TimeTickContext = createContext<number>(0);

export function TimeTickerProvider({
  children,
  intervalMs,
  reducedMotionIntervalMs = intervalMs,
}: {
  children: ReactNode;
  intervalMs: number;
  reducedMotionIntervalMs?: number;
}) {
  const [tick, setTick] = useState(0);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const activeIntervalMs = reducedMotion ? reducedMotionIntervalMs : intervalMs;

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let interval: number | undefined;
    const bumpTick = () => setTick((current) => current + 1);

    const start = () => {
      if (interval !== undefined) return;
      interval = window.setInterval(bumpTick, activeIntervalMs);
    };

    const stop = () => {
      if (interval === undefined) return;
      window.clearInterval(interval);
      interval = undefined;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }

      bumpTick();
      start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [activeIntervalMs]);

  return <TimeTickContext.Provider value={tick}>{children}</TimeTickContext.Provider>;
}

export function useTimeTick(): number {
  return useContext(TimeTickContext);
}
