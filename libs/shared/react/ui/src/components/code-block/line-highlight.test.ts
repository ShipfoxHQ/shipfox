import {highlightCodeBlockHtmlLines, isCodeBlockLineHighlighted} from './line-highlight.js';

describe('code block line highlighting', () => {
  test('detects inclusive highlighted line ranges', () => {
    expect(isCodeBlockLineHighlighted(2, {startLine: 2, endLine: 4})).toBe(true);
    expect(isCodeBlockLineHighlighted(4, {startLine: 2, endLine: 4})).toBe(true);
    expect(isCodeBlockLineHighlighted(5, {startLine: 2, endLine: 4})).toBe(false);
  });

  test('normalizes reversed ranges and ignores invalid ranges', () => {
    expect(isCodeBlockLineHighlighted(3, {startLine: 4, endLine: 2})).toBe(true);
    expect(isCodeBlockLineHighlighted(1, {startLine: 0, endLine: 2})).toBe(false);
    expect(isCodeBlockLineHighlighted(1, null)).toBe(false);
  });

  test('decorates Shiki line spans without changing unselected lines', () => {
    const html = [
      '<pre class="shiki"><code>',
      '<span class="line">one</span>',
      '<span class="line">two</span>',
      '<span class="line diff add">three</span>',
      '</code></pre>',
    ].join('');

    const decorated = highlightCodeBlockHtmlLines(html, {startLine: 2, endLine: 3});

    expect(decorated).toContain('<span class="line">one</span>');
    expect(decorated).toContain('<span class="line highlighted-line">two</span>');
    expect(decorated).toContain('<span class="line diff add highlighted-line">three</span>');
  });

  test('does not duplicate highlight classes on already highlighted spans', () => {
    const html = '<span class="line highlighted-line">one</span>';

    const decorated = highlightCodeBlockHtmlLines(html, {startLine: 1, endLine: 1});

    expect(decorated).toBe(html);
  });
});
