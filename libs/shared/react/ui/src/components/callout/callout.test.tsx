import {render} from '@testing-library/react';
import {Callout, CalloutContent, type CalloutType, calloutTypes} from './callout.js';

const typesWithDefaultGlyph = ['info', 'success', 'warning', 'error'] as const;

describe('Callout', () => {
  test.each(typesWithDefaultGlyph)('renders the default %s glyph when icon is unset', (type) => {
    const {container} = renderCallout({type});

    expect(container.querySelector('[data-slot="callout-icon"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="callout-line"]')).toBeNull();
  });

  test('renders a side-line for default type when icon is unset', () => {
    const {container} = renderCallout({type: 'default'});

    expect(container.querySelector('[data-slot="callout-icon"]')).toBeNull();
    expect(container.querySelector('[data-slot="callout-line"]')).not.toBeNull();
  });

  test.each(typesWithDefaultGlyph)('renders a screen-reader severity label for %s', (type) => {
    const {container} = renderCallout({type});

    expect(container.querySelector('.sr-only')?.textContent).toBe(`${typeLabel(type)}: `);
  });

  test.each(calloutTypes)('renders a custom glyph for %s', (type) => {
    const {container} = renderCallout({type, icon: 'bookOpen'});

    expect(container.querySelector('[data-slot="callout-icon"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="callout-line"]')).toBeNull();
  });

  test.each(calloutTypes)('renders the side-line for %s when icon is null', (type) => {
    const {container} = renderCallout({type, icon: null});

    expect(container.querySelector('[data-slot="callout-icon"]')).toBeNull();
    expect(container.querySelector('[data-slot="callout-line"]')).not.toBeNull();
  });

  test('keeps the migrated secondary success callout on the side-line treatment', () => {
    const {container} = renderCallout({type: 'success', variant: 'secondary', icon: null});

    expect(container.querySelector('[data-slot="callout-icon"]')).toBeNull();
    expect(container.querySelector('[data-slot="callout-line"]')).not.toBeNull();
  });
});

function renderCallout({
  type,
  variant = 'primary',
  icon,
}: {
  type: CalloutType;
  variant?: 'primary' | 'secondary';
  icon?: Parameters<typeof Callout>[0]['icon'];
}) {
  return render(
    <Callout type={type} variant={variant} icon={icon}>
      <CalloutContent>Body</CalloutContent>
    </Callout>,
  );
}

function typeLabel(type: (typeof typesWithDefaultGlyph)[number]) {
  return {
    info: 'Info',
    success: 'Success',
    warning: 'Warning',
    error: 'Error',
  }[type];
}
