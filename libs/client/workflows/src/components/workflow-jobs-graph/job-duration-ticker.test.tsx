import {act, render, screen} from '@testing-library/react';
import type {ReactNode} from 'react';
import {JobDurationLabel} from './job-duration-label.js';
import {JobDurationTickerProvider} from './job-duration-ticker.js';

const NOW = new Date('2026-06-26T12:00:00.000Z');
const STARTED = '2026-06-26T11:57:46.000Z'; // 2m 14s before NOW

function renderLive(children: ReactNode) {
  return render(<JobDurationTickerProvider>{children}</JobDurationTickerProvider>);
}

function setMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') ? reduced : query.includes('min-width'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: state});
}

describe('JobDurationTickerProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setMatchMedia(false);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setMatchMedia(false);
    setVisibility('visible');
  });

  test('advances a running duration every second', () => {
    renderLive(<JobDurationLabel duration={{kind: 'running', fromIso: STARTED}} />);

    expect(screen.getByText('2m 14s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('2m 15s')).toBeInTheDocument();
  });

  test('does not tick a finished duration', () => {
    renderLive(
      <JobDurationLabel
        duration={{kind: 'finished', fromIso: STARTED, toIso: NOW.toISOString()}}
      />,
    );

    expect(screen.getByText('2m 14s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
  });

  test('ticks at a calm 10s cadence under reduced motion (advances, never freezes)', () => {
    setMatchMedia(true);

    renderLive(<JobDurationLabel duration={{kind: 'running', fromIso: STARTED}} />);

    expect(screen.getByText('2m 14s')).toBeInTheDocument();

    // No per-second update under reduced motion.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('2m 14s')).toBeInTheDocument();

    // But it still advances at the slow cadence rather than freezing until the poll.
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.getByText('2m 24s')).toBeInTheDocument();
  });

  test('does not tick while the tab is hidden', () => {
    setVisibility('hidden');

    renderLive(<JobDurationLabel duration={{kind: 'running', fromIso: STARTED}} />);

    expect(screen.getByText('2m 14s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
  });
});
