import {render, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {codeToHtml} from 'shiki';
import {ThemeProvider} from '../theme/index.js';
import {
  CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE,
  CODE_BLOCK_HIGHLIGHTED_LINE_STYLE,
} from './code-content.js';
import {CodeBlockContent} from './index.js';

vi.mock('shiki', () => ({
  codeToHtml: vi.fn(),
}));

const highlightedHtml = [
  '<pre class="shiki"><code>',
  '<span class="line">one</span>',
  '<span class="line">two</span>',
  '<span class="line">three</span>',
  '</code></pre>',
].join('');

describe('CodeBlockContent', () => {
  test('highlights fallback-rendered lines', () => {
    renderCodeBlockContent({
      code: 'one\ntwo\nthree',
      highlightedLineRange: {startLine: 2, endLine: 3},
    });

    const highlightedLines = document.body.querySelectorAll('.line.highlighted-line');
    expect(highlightedLines).toHaveLength(2);
    expect(highlightedLines[0]?.textContent).toContain('two');
    expect(highlightedLines[1]?.textContent).toContain('three');
    expect(highlightedLines[0]?.classList.contains('text-foreground-highlight-interactive')).toBe(
      false,
    );
  });

  test('does not infer diff styling from YAML list markers', () => {
    renderCodeBlockContent({
      code: 'steps:\n  - uses: actions/checkout@v3',
    });

    const lines = document.body.querySelectorAll('.line');
    expect(lines[1]?.textContent).toContain('- uses: actions/checkout@v3');
    expect(lines[1]?.classList.contains('diff')).toBe(false);
    expect(lines[1]?.classList.contains('remove')).toBe(false);
  });

  test('highlights Shiki-rendered lines without re-highlighting on range-only changes', async () => {
    const codeToHtmlMock = vi.mocked(codeToHtml);
    codeToHtmlMock.mockResolvedValue(highlightedHtml);
    const code = 'one\ntwo\nthree';

    const {rerender} = renderCodeBlockContent({
      code,
      syntaxHighlighting: true,
      highlightedLineRange: {startLine: 2, endLine: 2},
    });

    await waitFor(() => {
      expect(document.body.querySelector('.shiki-override')).not.toBeNull();
    });
    expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.line.highlighted-line')?.textContent).toContain('two');

    rerender(
      <CodeBlockContentHost>
        <CodeBlockContent
          language="text"
          syntaxHighlighting
          highlightedLineRange={{startLine: 3, endLine: 3}}
        >
          {code}
        </CodeBlockContent>
      </CodeBlockContentHost>,
    );

    await waitFor(() => {
      expect(document.body.querySelector('.line.highlighted-line')?.textContent).toContain('three');
    });
    expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
  });

  test('keeps highlighted line backgrounds above the Shiki transparent reset', () => {
    expect(CODE_BLOCK_HIGHLIGHTED_LINE_STYLE).toContain('!bg-[');
    expect(CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE).toContain(':!bg-[');
  });
});

describe('CodeBlockContent scroll-into-view', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalMatchMedia = window.matchMedia;
  let scrollCalls: Array<{element: Element; options: ScrollIntoViewOptions | undefined}>;

  beforeEach(() => {
    scrollCalls = [];
    // jsdom does not implement scrollIntoView; install a recording stub on the
    // (fallback path's) rendered lines so we can assert which line is scrolled.
    Element.prototype.scrollIntoView = function scrollIntoViewStub(
      this: Element,
      options?: boolean | ScrollIntoViewOptions,
    ) {
      scrollCalls.push({element: this, options: options as ScrollIntoViewOptions | undefined});
    };
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
  });

  // jsdom never resolves the mocked Shiki highlighter, so CodeBlockContent only
  // ever paints its fallback path here; these assertions exercise that path. The
  // post-Shiki re-scroll is covered by the source-panel Storybook visual.
  test('scrolls the first highlighted line to center when enabled', () => {
    renderCodeBlockContent({
      code: 'one\ntwo\nthree\nfour',
      highlightedLineRange: {startLine: 2, endLine: 3},
      scrollHighlightedIntoView: true,
    });

    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]?.element.textContent).toContain('two');
    expect(scrollCalls[0]?.options).toMatchObject({block: 'center', behavior: 'smooth'});
  });

  test('does not scroll when the affordance is disabled', () => {
    renderCodeBlockContent({
      code: 'one\ntwo\nthree',
      highlightedLineRange: {startLine: 2, endLine: 2},
    });

    expect(scrollCalls).toHaveLength(0);
  });

  test('does not scroll when there is no highlighted range', () => {
    renderCodeBlockContent({code: 'one\ntwo\nthree', scrollHighlightedIntoView: true});

    expect(scrollCalls).toHaveLength(0);
  });

  test('uses an instant scroll under reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as typeof window.matchMedia;

    renderCodeBlockContent({
      code: 'one\ntwo\nthree',
      highlightedLineRange: {startLine: 2, endLine: 2},
      scrollHighlightedIntoView: true,
    });

    expect(scrollCalls[0]?.options).toMatchObject({block: 'center', behavior: 'auto'});
  });
});

function renderCodeBlockContent({
  code,
  syntaxHighlighting,
  highlightedLineRange,
  scrollHighlightedIntoView,
}: {
  code: string;
  syntaxHighlighting?: boolean | undefined;
  highlightedLineRange?: Parameters<typeof CodeBlockContent>[0]['highlightedLineRange'];
  scrollHighlightedIntoView?: boolean | undefined;
}) {
  return render(
    <CodeBlockContentHost>
      <CodeBlockContent
        language="text"
        highlightedLineRange={highlightedLineRange}
        {...(syntaxHighlighting === undefined ? {} : {syntaxHighlighting})}
        {...(scrollHighlightedIntoView === undefined ? {} : {scrollHighlightedIntoView})}
      >
        {code}
      </CodeBlockContent>
    </CodeBlockContentHost>,
  );
}

function CodeBlockContentHost({children}: {children: ReactNode}) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="code-block-content-test-theme">
      {children}
    </ThemeProvider>
  );
}
