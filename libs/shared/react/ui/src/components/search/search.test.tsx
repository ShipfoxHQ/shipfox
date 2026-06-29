import {fireEvent, render, screen} from '@testing-library/react';
import {useState} from 'react';
import {Search} from './search.js';
import {useKeyboardShortcut, useSearchContext} from './search-context.js';
import {SearchInline} from './search-inline.js';
import {SearchTrigger} from './search-trigger.js';

describe('SearchInline', () => {
  test('provides a default search label and clears with Escape', () => {
    render(<SearchInlineHost />);

    const input = screen.getByLabelText<HTMLInputElement>('Search');
    fireEvent.change(input, {target: {value: 'deploy'}});
    expect(input.value).toBe('deploy');

    fireEvent.keyDown(input, {key: 'Escape'});

    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  test('uses defaultValue for uncontrolled input state', () => {
    render(<SearchInline defaultValue="deploy" />);

    expect(screen.getByLabelText<HTMLInputElement>('Search').value).toBe('deploy');
  });

  test('composes consumer key handlers with Escape clear behavior', () => {
    const onKeyDown = vi.fn();
    render(<SearchInline defaultValue="deploy" onKeyDown={onKeyDown} />);

    const input = screen.getByLabelText<HTMLInputElement>('Search');
    fireEvent.keyDown(input, {key: 'Escape'});

    expect(input.value).toBe('');
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  test('does not render the clear button for immutable inputs', () => {
    const {rerender} = render(<SearchInline defaultValue="deploy" readOnly />);
    expect(screen.queryByLabelText('Clear search')).toBeNull();

    rerender(<SearchInline defaultValue="deploy" disabled />);
    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  test('does not clear immutable inputs with Escape', () => {
    render(<SearchInline defaultValue="deploy" readOnly />);

    const input = screen.getByLabelText<HTMLInputElement>('Search');
    fireEvent.keyDown(input, {key: 'Escape'});

    expect(input.value).toBe('deploy');
  });
});

describe('useKeyboardShortcut', () => {
  test('opens from meta shortcuts written with the command glyph', () => {
    const onTrigger = vi.fn();
    render(<ShortcutProbe shortcutKey="⌘k" onTrigger={onTrigger} />);

    fireEvent.keyDown(document, {key: 'k', metaKey: true});

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('ignores plain-key shortcuts while typing in editable fields', () => {
    const onTrigger = vi.fn();
    render(
      <>
        <ShortcutProbe shortcutKey="k" onTrigger={onTrigger} />
        <input aria-label="Editable field" />
        <div contentEditable data-testid="editable-region" />
      </>,
    );

    const editableRegion = screen.getByTestId('editable-region');
    Object.defineProperty(editableRegion, 'isContentEditable', {
      configurable: true,
      value: true,
    });

    fireEvent.keyDown(screen.getByLabelText('Editable field'), {key: 'k'});
    fireEvent.keyDown(editableRegion, {key: 'k'});
    fireEvent.keyDown(document, {key: 'k'});

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});

describe('SearchTrigger', () => {
  test('only shows a shortcut hint when one is configured', () => {
    const {rerender} = render(
      <Search>
        <SearchTrigger />
      </Search>,
    );

    expect(screen.queryByText('Cmd K')).toBeNull();

    rerender(
      <Search shortcutKey="meta+k">
        <SearchTrigger />
      </Search>,
    );

    expect(screen.getByText('Cmd K')).toBeDefined();
  });

  test('composes consumer click handlers with opening the search', () => {
    const onClick = vi.fn();
    render(
      <Search>
        <SearchTrigger onClick={onClick} />
        <SearchOpenProbe />
      </Search>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('search-open-probe').dataset.open).toBe('true');
  });
});

function SearchInlineHost() {
  const [value, setValue] = useState('');

  return <SearchInline value={value} onChange={(event) => setValue(event.target.value)} />;
}

function ShortcutProbe({shortcutKey, onTrigger}: {shortcutKey: string; onTrigger: () => void}) {
  useKeyboardShortcut(shortcutKey, onTrigger);
  return null;
}

function SearchOpenProbe() {
  const {open} = useSearchContext();
  return <div data-testid="search-open-probe" data-open={open} />;
}
