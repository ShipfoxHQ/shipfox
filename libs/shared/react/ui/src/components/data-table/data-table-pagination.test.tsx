import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {DataTablePagination} from './data-table-pagination.js';

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

describe('DataTablePagination', () => {
  test('renders a named navigation region and disables unavailable boundaries', async () => {
    const user = userEvent.setup();
    const onFirstPage = vi.fn();
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    render(
      <DataTablePagination
        canNextPage
        canPreviousPage={false}
        onFirstPage={onFirstPage}
        onNextPage={onNextPage}
        onPreviousPage={onPreviousPage}
        pageLabel="Page 1 of 3"
        resultCount={21}
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

    expect(onNextPage).toHaveBeenCalledOnce();
    expect(onFirstPage).not.toHaveBeenCalled();
    expect(onPreviousPage).not.toHaveBeenCalled();
  });

  test('forwards cursor-style previous and next capabilities without cursor state', async () => {
    const user = userEvent.setup();
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    render(
      <DataTablePagination
        aria-label="Audit log pages"
        canNextPage
        canPreviousPage
        nextPageLabel="Newer"
        onNextPage={onNextPage}
        onPreviousPage={onPreviousPage}
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
    render(
      <DataTablePagination
        canNextPage={false}
        canPreviousPage={false}
        onNextPage={vi.fn()}
        onPageSizeChange={onPageSizeChange}
        onPreviousPage={vi.fn()}
        pageSize={10}
        pageSizeOptions={[10, 25, 50]}
      />,
    );

    await user.click(screen.getByRole('combobox', {name: 'Rows per page'}));
    await user.click(await screen.findByRole('option', {name: '25'}));

    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });
});
