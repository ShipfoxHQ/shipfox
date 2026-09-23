import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  InspectorSection,
  InspectorSectionEmpty,
  PropertyList,
  PropertyRow,
} from './inspector-section.js';

describe('InspectorSection', () => {
  test('renders a canvas band with the title, count, and aside', () => {
    const {container} = render(
      <InspectorSection title="Job outputs" count={2} aside={<span>false</span>}>
        <InspectorSectionEmpty>Nothing yet</InspectorSectionEmpty>
      </InspectorSection>,
    );

    const band = container.querySelector('[data-slot="inspector-section-band"]');
    const heading = screen.getByRole('heading', {level: 3});

    expect(band?.classList.contains('bg-background-inspector-band')).toBe(true);
    expect(heading.textContent).toBe('Job outputs2');
    expect(within(band as HTMLElement).getByText('false')).toBeTruthy();
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });
});

describe('PropertyRow', () => {
  test('stacks the key over the value inside a description list', () => {
    render(
      <PropertyList>
        <PropertyRow label="artifact" labelFont="code" meta={<span>string</span>}>
          https://example.com
        </PropertyRow>
      </PropertyList>,
    );

    const term = screen.getByRole('term');
    const definition = screen.getByRole('definition');

    expect(within(term).getByText('artifact').classList.contains('font-code')).toBe(true);
    expect(within(term).getByText('string')).toBeTruthy();
    expect(definition.textContent).toBe('https://example.com');
  });

  test('copies the row value from the icon button', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(
      <PropertyList>
        <PropertyRow label="sha" copyValue="d34db33f" copyLabel="Copy sha">
          d34db33f
        </PropertyRow>
      </PropertyList>,
    );

    await user.click(screen.getByRole('button', {name: 'Copy sha'}));

    expect(writeText).toHaveBeenCalledWith('d34db33f');
    expect(screen.getByRole('button', {name: 'Copied'})).toBeTruthy();
  });

  test('renders no copy button without a copy value', () => {
    render(
      <PropertyList>
        <PropertyRow label="Received">2026-09-22</PropertyRow>
      </PropertyList>,
    );

    expect(screen.queryByRole('button')).toBeNull();
  });
});
