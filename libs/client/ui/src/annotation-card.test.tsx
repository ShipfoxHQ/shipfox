import {ThemeProvider} from '@shipfox/react-ui/theme';
import {render} from '@testing-library/react';
import type {ReactNode} from 'react';
import {AnnotationCard} from './annotation-card.js';

const styles = ['default', 'info', 'success', 'warning', 'error'] as const;
const stylesWithDefaultGlyph = ['info', 'success', 'warning', 'error'] as const;

describe('AnnotationCard', () => {
  test.each(styles)('renders %s annotations as callouts', (style) => {
    const {container} = renderAnnotationCard({style, body: `**${style}** body`});

    expect(container.querySelector('[data-slot="callout"]')).not.toBeNull();
  });

  test.each(stylesWithDefaultGlyph)('renders the default %s glyph', (style) => {
    const {container} = renderAnnotationCard({style, body: 'Body'});

    expect(container.querySelector('[data-slot="callout-icon"]')).not.toBeNull();
  });

  test('renders default style with the side-line treatment', () => {
    const {container} = renderAnnotationCard({style: 'default', body: 'Body'});

    expect(container.querySelector('[data-slot="callout-icon"]')).toBeNull();
    expect(container.querySelector('[data-slot="callout-line"]')).not.toBeNull();
  });

  test('renders sanitized Markdown', () => {
    const {container} = renderAnnotationCard({
      style: 'warning',
      body: '[safe](https://example.com) <img src=x onerror=alert(1)> <script>alert(1)</script>',
    });

    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  test('sets dir auto on rendered Markdown', () => {
    const {container} = renderAnnotationCard({style: 'info', body: 'שלום'});

    expect(container.querySelector('[dir="auto"]')).not.toBeNull();
  });

  test('renders nothing for empty bodies', () => {
    const {container} = renderAnnotationCard({style: 'error', body: ' \n '});

    expect(container.firstChild).toBeNull();
  });
});

function renderAnnotationCard({style, body}: {style: (typeof styles)[number]; body: string}) {
  return render(
    <AnnotationCardTestHost>
      <AnnotationCard style={style} body={body} />
    </AnnotationCardTestHost>,
  );
}

function AnnotationCardTestHost({children}: {children: ReactNode}) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="annotation-card-test-theme">
      {children}
    </ThemeProvider>
  );
}
