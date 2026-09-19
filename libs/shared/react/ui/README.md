# Shipfox React UI

Shared React component library for Shipfox apps. It provides design tokens, Tailwind CSS setup, common components, icons, theme state, hooks, and small UI utilities.

## What it does

- **Components**: Accordion, Alert, Avatar, Badge, Button, Calendar, Callout, Checkbox, CodeBlock, Collapsible, Combobox, Command, DataTable, DatePicker, DateRangePicker, Dot, DropdownMenu, EmptyState, FormField, Icon, Input, Kbd, Label, LoadErrorState, Loader, Log, Logo, Markdown, Modal, Panel, Popover, RadioGroup, RelativeTime, ScrollArea, Search, Select, Sheet, ShinyText, Skeleton, Switch, Table, Tabs, Textarea, ThemeProvider, Toast, Tooltip, and Typography.
- **Theme helpers**: `ThemeProvider`, `useTheme()`, and `useResolvedTheme()`.
- **Hooks**: `useCopyToClipboard`, `useIsTextTruncated`, `useShikiHighlight`, `useShikiStyleInjection`, plus the theme hooks above.
- **Utilities**: `cn()` for class name merging, `copyTextToClipboard`, `formatBytes`, `formatDate`/`formatTimestamp`, `formatDuration`/`humanDuration`, `formatRelative`, `debounce`, and avatar helpers (`getInitial`, `getPlaceholderImageUrl`).
- **Icons**: Custom Shipfox icons plus the icon registry used by the `Icon` component.
- **CSS entry**: `@shipfox/react-ui/index.css` for fonts, Tailwind, animation utilities, and design tokens.

## Public API

### Spacing boundary

The package owns two spacing vocabularies across one deliberate boundary:

- `libs/shared/react/ui` internals use the numeric scale for component tokens and dimensions.
- Consumers use semantic roles such as `gap-group`, `p-panel`, and `px-row` for product composition.

`index.css` sets `--spacing: 1px`, so numeric utility names equal pixel values.
The numeric vocabulary inside this package is permanent, not an unfinished
migration. See the [spacing rules in `DESIGN.md`](../../../../DESIGN.md#spacing)
for the role vocabulary and exception policy.

### Surface roles

The `@shipfox/react-ui/index.css` entry defines four target surface roles for page and component authors.
The table records the target contract, not every token's current resolution. Until the migration
lands, light canvas uses `--color-alpha-black-2`, light inline fill resolves to `#fafafa`, and dark
code resolves to `#27272a`. See [the surface ladder in `DESIGN.md`](../../../../DESIGN.md#the-surface-ladder)
for the current-versus-target mapping.

| Role | Token | Target light | Target dark | Used for |
| --- | --- | --- | --- | --- |
| Canvas | `background-subtle-base` | `#fafafa` | `#0f0f10` | the page, nav bar, tab strip, rails, object headers, panel header strips |
| Panel | `background-neutral-base` | `#ffffff` | `#1a1a1b` | panel bodies, rows, popovers, modals |
| Code | `background-contrast-*` | `#1a1a1b` | `#030303` | code, logs, YAML, agent transcripts |
| Inline fill | `background-components-base` | `#f4f4f5` | `#27272a` | avatars, badges, kbd, chips inside a panel |

The ladder follows two rules:

- Panel sits one ramp step toward the foreground from canvas in both themes. A panel header strip sits one step below its panel, which is the canvas value.
- Page, panel, or code surfaces should use opaque tokens, because alpha composites over a parent that varies. During migration, light-mode canvas is the current exception: `background-subtle-base` uses `--color-alpha-black-2` and resolves to `#fafafa` over white.

## Imports

Import from a subpath. Each component has its own entry
(`@shipfox/react-ui/button`, `@shipfox/react-ui/panel`, ...); hooks live under
`@shipfox/react-ui/hooks` and utilities under `@shipfox/react-ui/utils`. This
keeps the dev server and bundlers from pulling the whole component tree (and its
Radix and icon dependencies) when you only need one component. The package root
(`@shipfox/react-ui`) is not importable: there is no root barrel, and a bare
import is blocked by lint.

## Setup

Install the package in a React app:

```json
{
  "dependencies": {
    "@shipfox/react-ui": "workspace:*"
  }
}
```

Import the CSS once near the app root:

```ts
import '@shipfox/react-ui/index.css';
```

Wrap the app with the theme provider:

```tsx
import {ThemeProvider} from '@shipfox/react-ui/theme';

export function AppRoot() {
  return (
    <ThemeProvider defaultTheme="system">
      <App />
    </ThemeProvider>
  );
}
```

## Usage

```tsx
import {Panel, PanelBody, PanelHeader, PanelRow, PanelTitle} from '@shipfox/react-ui/panel';

export function ProjectList() {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Projects</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <PanelRow>Shipfox</PanelRow>
      </PanelBody>
    </Panel>
  );
}
```

`Panel` is the shared container for a data region. Use `PanelRow` for rows and
keep panels flat. Rows use a neutral hover surface, and status stays in glyphs or
pills. Use `PanelHeader` with `variant="plain"` for a titled block on a focused
surface.

### Tables

Choose the table API by behavior:

| Need | API |
| --- | --- |
| Fixed read-only rows without dataset controls | `@shipfox/react-ui/table` |
| Sorting, filtering, pagination, selection, visibility, or shared data states | `@shipfox/react-ui/data-table` |

`DataTable` renders a configured TanStack Table instance. The feature keeps
ownership of columns, row models, data fetching, route state, and browser state.
The feature must also supply a stable `getRowId` when array position is not
durable.

```tsx
import {createColumnHelper, tableFeatures, useTable} from '@tanstack/react-table';
import {DataTable} from '@shipfox/react-ui/data-table';

interface Workflow {
  id: string;
  name: string;
}

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, Workflow>();
const columns = columnHelper.columns([
  columnHelper.accessor('name', {header: 'Workflow'}),
]);

export function WorkflowTable({workflows}: {workflows: Workflow[]}) {
  const table = useTable({
    columns,
    data: workflows,
    features,
    getRowId: (workflow) => workflow.id,
  });

  return (
    <DataTable
      table={table}
      aria-label="Project workflows"
      emptyContent="No workflows yet."
    />
  );
}
```

`DataTableLoading` and `DataTableEmpty` expose the table-body states for custom
composition. `DataTable` uses them automatically for initial loading and empty
results. Background refresh keeps current rows visible and sets `aria-busy`.

#### Pagination

`DataTablePagination` uses a controlled, data-source-neutral contract. Pass capability
flags and callbacks from the feature that owns pagination. The component never
accepts or stores an opaque cursor.

```tsx
<DataTablePagination
  aria-label="Workflow pages"
  canPreviousPage={previousCursor !== null}
  canNextPage={nextCursor !== null}
  onPreviousPage={() => navigateToCursor(previousCursor)}
  onNextPage={() => navigateToCursor(nextCursor)}
  pageLabel="Current result page"
/>
```

Bounded client-side tables can pass `table.getCanPreviousPage()`,
`table.getCanNextPage()`, `table.previousPage()`, and `table.nextPage()`.
Add `pageSize`, `pageSizeOptions`, and `onPageSizeChange` together when users
can control the page size.

#### Row selection

Use `DataTableSelectionHeader` and `DataTableSelectionCell` in a TanStack
display column. Both helpers compose the shared `Checkbox`. The header affects
selectable rows on the current loaded page and becomes indeterminate after a
partial selection.

```tsx
const selectionColumn = columnHelper.display({
  id: 'selection',
  header: ({table}) => (
    <DataTableSelectionHeader
      table={table}
      aria-label="Select current page workflows"
    />
  ),
  cell: ({row}) => (
    <DataTableSelectionCell
      row={row}
      aria-label={`Select ${row.original.name}`}
    />
  ),
});
```

Configure `getRowId` with a stable ID from the application. `DataTable` maps
TanStack selection to the existing `data-selected` row style. A checked row
also contains a checkbox, so selection does not depend on color.

`DataTableSelectionSummary` announces selected and total row counts through a
polite live region. Selection resets after page, filter, and sorting changes by
default. `shouldResetDataTableSelection()` exposes that policy for feature-owned
state transitions. Only override a page reset when the feature owns a defined
cross-page bulk action.

#### Sorting and filters

`DataTableToolbar` lays out feature-owned controls. Pass Search, Select,
Combobox, DatePicker, or DateRangePicker components as children. The toolbar
doesn't define filter state or a filter schema.

Use `clearFiltersAction` for the feature's reset button. `resultCount` renders
visible feedback in a polite live region. The `actions` slot holds view controls
such as `DataTableColumnVisibility`.

Sortable and hideable columns use TanStack features. Add
`DataTableColumnMeta` through `metaHelper()` so visibility labels stay typed.

```tsx
import {
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  metaHelper,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table';
import {
  DataTableColumnVisibility,
  type DataTableColumnMeta,
  DataTableSortableHeader,
  DataTableToolbar,
} from '@shipfox/react-ui/data-table';

const interactiveFeatures = tableFeatures({
  columnMeta: metaHelper<DataTableColumnMeta>(),
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const interactiveColumnHelper = createColumnHelper<typeof interactiveFeatures, Workflow>();
const interactiveColumns = interactiveColumnHelper.columns([
  interactiveColumnHelper.accessor('name', {
    enableHiding: false,
    header: ({column}) => <DataTableSortableHeader column={column} label="Workflow" />,
    meta: {label: 'Workflow'},
  }),
]);

<DataTableToolbar
  resultCount={table.getRowModel().rows.length}
  clearFiltersAction={clearFiltersButton}
  actions={<DataTableColumnVisibility table={table} />}
>
  {featureFilters}
</DataTableToolbar>;
```

Set `enableHiding: false` on primary identity and required action columns.
Column visibility uses the table's local state by default. DataTable doesn't
write browser storage.

Client-side sorting registers `createSortedRowModel()`. Manual sorting sets
`manualSorting: true` and passes server-sorted data. Reset pagination in the
feature callback that owns both values:

```tsx
const table = useTable({
  columns,
  data: serverSortedWorkflows,
  features,
  manualSorting: true,
  state: {sorting},
  onSortingChange: (updater) => {
    setSorting(updater);
    setPageIndex(0);
  },
});
```

Version 2 removes `Card`. Migrate `Card` to `Panel`, `CardHeader` to
`PanelHeader variant="plain"`, `CardTitle` to `PanelTitle`, `CardContent` to
`PanelBody`, `CardAction` to `PanelActions`, and `CardDescription` to a `Text`
with `className="text-foreground-neutral-muted"`. Keep `CardFooter` content in
the panel layout or a `PanelBody`.

`FormField` wires up label, input, error, and description with the correct `id`, `aria-invalid`, and `aria-describedby` plumbing. Render controls through `FormFieldInput` or `FormFieldTextarea` to inherit those props automatically:

```tsx
import {FormField, FormFieldInput, FormFieldTextarea} from '@shipfox/react-ui/form-field';

<FormField label="Email" id="email" error={error}>
  <FormFieldInput type="email" value={value} onChange={...} />
</FormField>

<FormField label="Notes" id="notes" error={error}>
  <FormFieldTextarea value={value} onChange={...} />
</FormField>
```

### Checkbox

Import `Checkbox` from `@shipfox/react-ui/checkbox`. It supports controlled and
uncontrolled checked, unchecked, and indeterminate states through the Radix
checkbox contract. Supply an accessible name with a visible `Label`,
`aria-label`, or `aria-labelledby`. Forward descriptions with
`aria-describedby`; native disabled, focus, and form properties pass through.

```tsx
import {useState} from 'react';
import {Checkbox, type CheckedState} from '@shipfox/react-ui/checkbox';

const [checked, setChecked] = useState<CheckedState>('indeterminate');

<Checkbox
  aria-label="Select visible workflows"
  checked={checked}
  onCheckedChange={setChecked}
/>;
```

For table selection, place the same component directly inside `TableHead` or
`TableCell`. The table primitives already recognize its checkbox role and apply
the selection-column spacing.

## Storybook

Components are documented in Storybook stories under `src/**/*.stories.tsx`:

```sh
pnpm --filter=@shipfox/react-ui storybook
```

For repository-wide story ordering and Argos rules, read the
[testing guide](../../../../docs/guides/testing.md). This package captures stories
in light and dark under `turbo test`.

## Build

The package builds JavaScript with SWC and CSS with Vite:

```sh
turbo build --filter=@shipfox/react-ui
```

The CSS build writes `dist/styles.css`. The package also exports `./index.css` for source CSS.

## Development

```sh
turbo check --filter=@shipfox/react-ui
turbo type --filter=@shipfox/react-ui
turbo build --filter=@shipfox/react-ui
turbo test --filter=@shipfox/react-ui
```

## License

MIT
