import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {type DataTableAppendNavigation, DataTableNavigation} from './data-table-navigation.js';

const appendNavigation: DataTableAppendNavigation = {
  hasMore: true,
  isError: false,
  isLoading: false,
  kind: 'append',
  loadedCount: 50,
  onLoadMore: vi.fn(),
  onRetry: vi.fn(),
};

describe('DataTableNavigation', () => {
  test('renders a complete count without a navigation control', () => {
    render(<DataTableNavigation kind="complete" count={1} />);

    expect(screen.getByRole('region', {name: 'Table navigation'}).textContent).toBe('1 row');
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('announces loaded rows without implying a producer total', () => {
    render(<DataTableNavigation {...appendNavigation} />);

    const status = screen.getByRole('status');

    expect(status.textContent).toBe('50 rows loaded');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).not.toContain('total');
  });

  test('includes an optional producer total in the loaded count', () => {
    render(<DataTableNavigation {...appendNavigation} totalCount={143} />);

    expect(screen.getByRole('status').textContent).toBe('50 loaded of 143');
  });

  test('requests more rows and reports the appending state without replacing loaded rows', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const {rerender} = render(
      <DataTableNavigation {...appendNavigation} onLoadMore={onLoadMore} />,
    );

    const loadMore = screen.getByRole('button', {name: 'Load more'});
    await user.click(loadMore);

    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(<DataTableNavigation {...appendNavigation} isLoading onLoadMore={onLoadMore} />);

    expect(screen.getByRole('button', {name: 'Load more'}).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByRole('status').textContent).toBe('50 rows loaded');

    screen.getByRole('button', {name: 'Load more'}).click();

    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(
      <DataTableNavigation {...appendNavigation} loadedCount={75} onLoadMore={onLoadMore} />,
    );

    expect(screen.getByRole('status').textContent).toBe('75 rows loaded');
    expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Load more'}));
  });

  test('moves focus to retry after failure only while load more still holds focus', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const {rerender} = render(
      <>
        <DataTableNavigation {...appendNavigation} onRetry={onRetry} />
        <button type="button">Reader target</button>
      </>,
    );

    await user.click(screen.getByRole('button', {name: 'Load more'}));
    rerender(
      <>
        <DataTableNavigation {...appendNavigation} isError onRetry={onRetry} />
        <button type="button">Reader target</button>
      </>,
    );

    const retry = screen.getByRole('button', {name: 'Retry'});
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole('status').textContent).toBe('Could not load more rows. 50 rows loaded');

    await user.click(retry);

    expect(onRetry).toHaveBeenCalledOnce();

    rerender(
      <>
        <DataTableNavigation {...appendNavigation} isLoading onRetry={onRetry} />
        <button type="button">Reader target</button>
      </>,
    );

    expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Load more'}));

    rerender(
      <>
        <DataTableNavigation {...appendNavigation} />
        <button type="button">Reader target</button>
      </>,
    );
    await user.click(screen.getByRole('button', {name: 'Reader target'}));
    rerender(
      <>
        <DataTableNavigation {...appendNavigation} isError />
        <button type="button">Reader target</button>
      </>,
    );

    expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Reader target'}));
  });

  test('moves focus to the footer on exhaustion only while load more still holds focus', async () => {
    const user = userEvent.setup();
    const {rerender} = render(
      <>
        <DataTableNavigation {...appendNavigation} />
        <button type="button">Reader target</button>
      </>,
    );

    await user.click(screen.getByRole('button', {name: 'Load more'}));
    rerender(
      <>
        <DataTableNavigation {...appendNavigation} hasMore={false} loadedCount={75} />
        <button type="button">Reader target</button>
      </>,
    );

    const footer = screen.getByRole('region', {name: 'Table navigation'});
    expect(document.activeElement).toBe(footer);
    expect(screen.queryByRole('button', {name: 'Load more'})).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('75 rows loaded. No more rows to load.');

    rerender(
      <>
        <DataTableNavigation {...appendNavigation} />
        <button type="button">Reader target</button>
      </>,
    );
    await user.click(screen.getByRole('button', {name: 'Reader target'}));
    rerender(
      <>
        <DataTableNavigation {...appendNavigation} hasMore={false} />
        <button type="button">Reader target</button>
      </>,
    );

    expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Reader target'}));
  });
});
