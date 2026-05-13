import {render, screen} from '@testing-library/react';
import {RelativeTime, RelativeTimeProvider} from './relative-time.js';

function renderWithProvider(node: React.ReactNode) {
  return render(<RelativeTimeProvider>{node}</RelativeTimeProvider>);
}

describe('RelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders "Xs ago" for sub-minute past timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-05-13T00:00:12.000Z'));

    renderWithProvider(<RelativeTime value="2026-05-13T00:00:00.000Z" />);

    expect(screen.getByText('12s ago')).toBeInTheDocument();
  });

  test('renders "Nm ago" between 1 minute and 1 hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-05-13T00:05:00.000Z'));

    renderWithProvider(<RelativeTime value="2026-05-13T00:00:00.000Z" />);

    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  test('renders "Nh ago" between 1 hour and 1 day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-05-13T03:30:00.000Z'));

    renderWithProvider(<RelativeTime value="2026-05-13T00:00:00.000Z" />);

    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  test('renders "Nd ago" past a day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-05-15T00:00:00.000Z'));

    renderWithProvider(<RelativeTime value="2026-05-13T00:00:00.000Z" />);

    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  test('returns empty string for unparseable input', () => {
    const {container} = renderWithProvider(<RelativeTime value="not-a-date" />);

    expect(container.textContent).toBe('');
  });
});
