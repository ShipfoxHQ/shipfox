import {act, render, screen, waitFor} from '@testing-library/react';
import {useIsTextTruncated} from './use-is-text-truncated.js';

const originalScrollWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'scrollWidth',
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'clientWidth',
);
const originalResizeObserver = window.ResizeObserver;

afterEach(() => {
  restoreElementWidthDescriptors();
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: originalResizeObserver,
  });
});

describe('useIsTextTruncated', () => {
  test('detects text that is wider than its visible element', async () => {
    setElementWidths({scrollWidth: 120, clientWidth: 80});

    render(<TruncationProbe label="release-production" />);

    await waitFor(() => {
      expect(screen.getByTestId('truncation-probe')).toHaveAttribute('data-truncated', 'true');
    });
  });

  test('does not report truncation when the full text fits', async () => {
    setElementWidths({scrollWidth: 80, clientWidth: 120});

    render(<TruncationProbe label="deploy" />);

    await waitFor(() => {
      expect(screen.getByTestId('truncation-probe')).toHaveAttribute('data-truncated', 'false');
    });
  });

  test('re-checks truncation on observed element resize and disconnects on unmount', async () => {
    let scrollWidth = 80;
    let clientWidth = 120;
    let resizeCallback: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    class ResizeObserverProbe {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe(): void {
        /* no-op */
      }
      disconnect(): void {
        disconnect();
      }
    }
    setElementWidths({
      get scrollWidth() {
        return scrollWidth;
      },
      get clientWidth() {
        return clientWidth;
      },
    });
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverProbe,
    });

    const {unmount} = render(<TruncationProbe label="deploy" />);
    await waitFor(() => {
      expect(screen.getByTestId('truncation-probe')).toHaveAttribute('data-truncated', 'false');
    });

    scrollWidth = 160;
    clientWidth = 100;
    act(() => resizeCallback?.([], {} as ResizeObserver));

    expect(screen.getByTestId('truncation-probe')).toHaveAttribute('data-truncated', 'true');

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test('checks once without requiring ResizeObserver', async () => {
    setElementWidths({scrollWidth: 140, clientWidth: 100});
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: undefined,
    });

    render(<TruncationProbe label="release-production" />);

    await waitFor(() => {
      expect(screen.getByTestId('truncation-probe')).toHaveAttribute('data-truncated', 'true');
    });
  });

  test('measures when the element mounts after the hook with unchanged text', async () => {
    setElementWidths({scrollWidth: 140, clientWidth: 100});

    const {rerender} = render(<ConditionalTruncationProbe label="deploy" visible={false} />);
    expect(screen.getByTestId('conditional-truncation-probe')).toHaveAttribute(
      'data-truncated',
      'false',
    );

    rerender(<ConditionalTruncationProbe label="deploy" visible />);

    await waitFor(() => {
      expect(screen.getByTestId('conditional-truncation-probe')).toHaveAttribute(
        'data-truncated',
        'true',
      );
    });
  });

  test('re-checks when the measured element is replaced with unchanged text', async () => {
    setElementWidthGetters({
      scrollWidth: (element) => (element.dataset.width === 'clipped' ? 160 : 80),
      clientWidth: (element) => (element.dataset.width === 'clipped' ? 100 : 120),
    });

    const {rerender} = render(<ReplacementTruncationProbe label="deploy" width="fits" />);
    await waitFor(() => {
      expect(screen.getByTestId('replacement-truncation-probe')).toHaveAttribute(
        'data-truncated',
        'false',
      );
    });

    rerender(<ReplacementTruncationProbe label="deploy" width="clipped" />);

    await waitFor(() => {
      expect(screen.getByTestId('replacement-truncation-probe')).toHaveAttribute(
        'data-truncated',
        'true',
      );
    });
  });
});

function TruncationProbe({label}: {label: string}) {
  const {ref, isTruncated} = useIsTextTruncated<HTMLSpanElement>(label);

  return (
    <span ref={ref} data-testid="truncation-probe" data-truncated={isTruncated}>
      {label}
    </span>
  );
}

function ConditionalTruncationProbe({label, visible}: {label: string; visible: boolean}) {
  const {ref, isTruncated} = useIsTextTruncated<HTMLSpanElement>(label);

  return (
    <div data-testid="conditional-truncation-probe" data-truncated={isTruncated}>
      {visible ? <span ref={ref}>{label}</span> : null}
    </div>
  );
}

function ReplacementTruncationProbe({label, width}: {label: string; width: 'fits' | 'clipped'}) {
  const {ref, isTruncated} = useIsTextTruncated<HTMLSpanElement>(label);

  return (
    <span
      key={width}
      ref={ref}
      data-testid="replacement-truncation-probe"
      data-truncated={isTruncated}
      data-width={width}
    >
      {label}
    </span>
  );
}

function setElementWidths(widths: {scrollWidth: number; clientWidth: number}) {
  setElementWidthGetters({
    scrollWidth: () => widths.scrollWidth,
    clientWidth: () => widths.clientWidth,
  });
}

function setElementWidthGetters(widths: {
  scrollWidth: (element: HTMLElement) => number;
  clientWidth: (element: HTMLElement) => number;
}) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: function getScrollWidth(this: HTMLElement) {
      return widths.scrollWidth(this);
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: function getClientWidth(this: HTMLElement) {
      return widths.clientWidth(this);
    },
  });
}

function restoreElementWidthDescriptors() {
  if (originalScrollWidth) {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
  } else {
    delete (window.HTMLElement.prototype as {scrollWidth?: number}).scrollWidth;
  }

  if (originalClientWidth) {
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidth);
  } else {
    delete (window.HTMLElement.prototype as {clientWidth?: number}).clientWidth;
  }
}
