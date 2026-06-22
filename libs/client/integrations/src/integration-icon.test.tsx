// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {render} from '@testing-library/react';
import {IntegrationIcon} from './integration-icon.js';

describe('IntegrationIcon', () => {
  it('exposes a labeled icon to assistive tech when it is the sole identifier', () => {
    const {container} = render(<IntegrationIcon source="github" aria-label="GitHub" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'GitHub');
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('hides the icon from assistive tech when marked decorative', () => {
    const {container} = render(<IntegrationIcon source="github" aria-hidden />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards class names so callers control sizing and color', () => {
    const {container} = render(
      <IntegrationIcon source="github" className="size-24 text-foreground-neutral-base" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-24', 'text-foreground-neutral-base');
  });

  it('forwards sizing and label to the neutral fallback glyph for an unknown source', () => {
    const {container} = render(
      <IntegrationIcon source="gitlab" aria-label="GitLab" className="size-24" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'GitLab');
    expect(svg).toHaveClass('size-24');
  });
});
