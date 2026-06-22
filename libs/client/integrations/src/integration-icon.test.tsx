// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {render} from '@testing-library/react';
import {
  FALLBACK_INTEGRATION_ICON,
  getIntegrationIcon,
  IntegrationIcon,
} from './integration-icon.js';

describe('getIntegrationIcon', () => {
  it('resolves cataloged providers to the icon they declare', () => {
    expect(getIntegrationIcon('github')).toBe('github');
    expect(getIntegrationIcon('sentry')).toBe('sentry');
  });

  it('falls back for sources missing from the catalog', () => {
    expect(getIntegrationIcon('gitlab')).toBe(FALLBACK_INTEGRATION_ICON);
    expect(getIntegrationIcon('mystery')).toBe(FALLBACK_INTEGRATION_ICON);
  });

  it.each([['' as const], [null], [undefined]])('falls back for an empty source (%s)', (source) => {
    expect(getIntegrationIcon(source)).toBe(FALLBACK_INTEGRATION_ICON);
  });
});

describe('IntegrationIcon', () => {
  it('renders an accessible icon for a cataloged source', () => {
    const {getByLabelText} = render(<IntegrationIcon source="github" aria-label="GitHub" />);

    expect(getByLabelText('GitHub')).toBeInTheDocument();
  });

  it('forwards class names so callers control sizing and color', () => {
    const {container} = render(
      <IntegrationIcon source="github" className="size-24 text-foreground-neutral-base" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-24', 'text-foreground-neutral-base');
  });
});
