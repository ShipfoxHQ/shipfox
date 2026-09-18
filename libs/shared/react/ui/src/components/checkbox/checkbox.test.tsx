import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createRef, useState} from 'react';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '../table/index.js';
import {Checkbox, type CheckedState} from './checkbox.js';

const originalResizeObserver = window.ResizeObserver;

afterEach(() => {
  window.ResizeObserver = originalResizeObserver;
});

/** Radix's form input measures the visible control, which jsdom cannot do. */
function stubResizeObserver() {
  window.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
}

function ControlledCheckbox({initialChecked = false}: {initialChecked?: CheckedState}) {
  const [checked, setChecked] = useState<CheckedState>(initialChecked);

  return <Checkbox aria-label="Select workflow" checked={checked} onCheckedChange={setChecked} />;
}

describe('Checkbox', () => {
  test('supports controlled pointer activation', async () => {
    const user = userEvent.setup();
    render(<ControlledCheckbox />);
    const checkbox = screen.getByRole('checkbox', {name: 'Select workflow'});

    await user.click(checkbox);

    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(checkbox.getAttribute('data-state')).toBe('checked');
  });

  test('supports controlled keyboard activation', async () => {
    const user = userEvent.setup();
    render(<ControlledCheckbox />);

    await user.tab();
    await user.keyboard(' ');

    const checkbox = screen.getByRole('checkbox', {name: 'Select workflow'});
    expect(checkbox).toBe(document.activeElement);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
  });

  test('exposes the indeterminate state to assistive technology', () => {
    render(<Checkbox aria-label="Select visible workflows" checked="indeterminate" />);

    const checkbox = screen.getByRole('checkbox', {name: 'Select visible workflows'});
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
    expect(checkbox.getAttribute('data-state')).toBe('indeterminate');
  });

  test('forwards accessible descriptions and focus', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <>
        <Checkbox
          ref={ref}
          aria-label="Select release workflow"
          aria-describedby="selection-description"
        />
        <span id="selection-description">Includes this workflow in the release.</span>
      </>,
    );

    ref.current?.focus();

    const checkbox = screen.getByRole('checkbox', {name: 'Select release workflow'});
    expect(checkbox).toBe(document.activeElement);
    expect(checkbox.getAttribute('aria-describedby')).toBe('selection-description');
  });

  test('does not activate while disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox aria-label="Select disabled workflow" disabled onCheckedChange={onCheckedChange} />,
    );

    await user.click(screen.getByRole('checkbox', {name: 'Select disabled workflow'}));

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('checkbox', {name: 'Select disabled workflow'}).hasAttribute('disabled'),
    ).toBe(true);
  });

  test('forwards checked values into forms', () => {
    stubResizeObserver();

    const {container} = render(
      <form>
        <Checkbox
          aria-label="Select workflow for submission"
          defaultChecked
          name="workflow"
          required
          value="deploy-production"
        />
      </form>,
    );
    const form = container.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Form did not render.');

    expect(new FormData(form).get('workflow')).toBe('deploy-production');
    expect(
      screen
        .getByRole('checkbox', {name: 'Select workflow for submission'})
        .getAttribute('aria-required'),
    ).toBe('true');
  });

  test('renders inside table selection cells without table-specific props', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox aria-label="Select visible workflows" checked="indeterminate" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>
              <Checkbox aria-label="Select Deploy production" checked />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole('checkbox', {name: 'Select visible workflows'})).toBeDefined();
    expect(screen.getByRole('checkbox', {name: 'Select Deploy production'})).toBeDefined();
  });

  test('uses the semantic state and focus tokens', () => {
    render(<Checkbox aria-label="Select workflow" />);
    const checkbox = screen.getByRole('checkbox', {name: 'Select workflow'});

    expect(checkbox.classList.contains('shadow-checkbox-unchecked')).toBe(true);
    expect(checkbox.classList.contains('focus-visible:shadow-checkbox-unchecked-focus')).toBe(true);
    expect(checkbox.classList.contains('data-[state=checked]:shadow-checkbox-checked')).toBe(true);
    expect(
      checkbox.classList.contains(
        'data-[state=indeterminate]:focus-visible:shadow-checkbox-indeterminate-focus',
      ),
    ).toBe(true);
  });
});
