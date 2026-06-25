import {render, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {codeToHtml} from 'shiki';
import {ThemeProvider} from '../theme/index.js';
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
});

function renderCodeBlockContent({
  code,
  syntaxHighlighting,
  highlightedLineRange,
}: {
  code: string;
  syntaxHighlighting?: boolean | undefined;
  highlightedLineRange?: Parameters<typeof CodeBlockContent>[0]['highlightedLineRange'];
}) {
  return render(
    <CodeBlockContentHost>
      <CodeBlockContent
        language="text"
        highlightedLineRange={highlightedLineRange}
        {...(syntaxHighlighting === undefined ? {} : {syntaxHighlighting})}
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
