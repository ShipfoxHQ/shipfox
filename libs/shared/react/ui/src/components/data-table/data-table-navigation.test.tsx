import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type DataTableAppendNavigation,
  DataTableNavigation,
  type DataTablePagedNavigation,
} from './data-table-navigation.js';

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
}

if (!HTMLElement.prototype.setPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

if (!HTMLElement.prototype.releasePointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
}

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

  test('renders a named paged navigation region and disables unavailable boundaries', async () => {
    const user = userEvent.setup();
    const onFirstPage = vi.fn();
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    render(
      <DataTableNavigation
        kind="paged"
        onPageChange={onNextPage}
        pageCount={3}
        pageIndex={0}
        pageLabel="Page 1 of 3"
        totalCount={21}
      />,
    );

    const navigation = screen.getByRole('navigation', {name: 'Table pagination'});
    const firstPage = screen.getByRole('button', {name: 'First'});
    const previousPage = screen.getByRole('button', {name: 'Previous'});
    const nextPage = screen.getByRole('button', {name: 'Next'});

    expect(navigation).toBeDefined();
    expect(firstPage.hasAttribute('disabled')).toBe(true);
    expect(previousPage.hasAttribute('disabled')).toBe(true);
    expect(nextPage.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('21 results');
    expect(screen.getByText('Page 1 of 3')).toBeDefined();

    await user.click(nextPage);

    expect(onNextPage).toHaveBeenCalledWith(1);
    expect(onFirstPage).not.toHaveBeenCalled();
    expect(onPreviousPage).not.toHaveBeenCalled();
  });

  test('forwards cursor-style previous and next capabilities without cursor state', async () => {
    const user = userEvent.setup();
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    render(
      <DataTableNavigation
        kind="paged"
        aria-label="Audit log pages"
        nextPageLabel="Newer"
        onPageChange={(pageIndex) => {
          if (pageIndex === 0) onPreviousPage();
          if (pageIndex === 2) onNextPage();
        }}
        pageCount={3}
        pageIndex={1}
        previousPageLabel="Older"
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Older'}));
    await user.click(screen.getByRole('button', {name: 'Newer'}));

    expect(screen.getByRole('navigation', {name: 'Audit log pages'})).toBeDefined();
    expect(onPreviousPage).toHaveBeenCalledOnce();
    expect(onNextPage).toHaveBeenCalledOnce();
  });

  test('renders optional controlled page-size choices', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    const pagedNavigation: DataTablePagedNavigation = {
      kind: 'paged',
      onPageChange: vi.fn(),
      onPageSizeChange,
      pageCount: 3,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
    };
    render(<DataTableNavigation {...pagedNavigation} />);

    await user.click(screen.getByRole('combobox', {name: 'Rows per page'}));
    await user.click(await screen.findByRole('option', {name: '25'}));

    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });
});
