import {render, screen} from '@testing-library/react';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './message-scroller.js';

function Transcript() {
  return (
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            <MessageScrollerItem messageId="sent" scrollAnchor>
              Why did this fail?
            </MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

describe('MessageScroller', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps streamed text out of the screen reader queue', () => {
    render(<Transcript />);

    const transcript = screen.getByRole('log');

    expect(transcript.getAttribute('aria-live')).toBe('off');
  });

  it('labels the viewport so keyboard users can reach and scroll it', () => {
    render(<Transcript />);

    const viewport = screen.getByRole('region', {name: 'Messages'});

    expect(viewport.getAttribute('tabindex')).toBe('0');
  });

  it('takes Jump to latest out of the tab order when nothing sits below', () => {
    render(<Transcript />);

    const button = screen.getByText('Jump to latest').closest('button');

    expect(button?.getAttribute('data-active')).toBe('false');
    expect(button?.getAttribute('tabindex')).toBe('-1');
  });
});
