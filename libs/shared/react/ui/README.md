# Shipfox React UI

Shared React component library for Shipfox apps. It provides design tokens, Tailwind CSS setup, common components, icons, theme state, hooks, and small UI utilities.

## What it does

- **Components**: Accordion, Alert, Avatar, Badge, Button, Calendar, Card, CodeBlock, Collapsible, Combobox, Command, DatePicker, DateRangePicker, Dot, DropdownMenu, EmptyState, FormField, Icon, InlineTips, Input, Kbd, Label, LoadErrorState, Loader, Log, Logo, Modal, Popover, RadioGroup, RelativeTime, ScrollArea, Search, Select, Sheet, ShinyText, Skeleton, Switch, Table, Tabs, ThemeProvider, Toast, Tooltip, and Typography.
- **Theme helpers**: `ThemeProvider`, `useTheme()`, and `useResolvedTheme()`.
- **Hooks**: `useCopyToClipboard`, `useIsTextTruncated`, `useShikiHighlight`, `useShikiStyleInjection`, plus the theme hooks above.
- **Utilities**: `cn()` for class name merging, `copyTextToClipboard`, `formatBytes`, `formatDate`/`formatTimestamp`, `formatDuration`/`humanDuration`, `formatRelative`, `debounce`, and avatar helpers (`getInitial`, `getPlaceholderImageUrl`).
- **Icons**: Custom Shipfox icons plus the icon registry used by the `Icon` component.
- **CSS entry**: `@shipfox/react-ui/index.css` for fonts, Tailwind, animation utilities, and design tokens.

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
import {ThemeProvider} from '@shipfox/react-ui';

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
import {Button, Card, CardContent, CardTitle, Text} from '@shipfox/react-ui';

export function EmptyState() {
  return (
    <Card>
      <CardTitle>No projects yet</CardTitle>
      <CardContent>
        <Text size="sm">Create a project to start running workflows.</Text>
      </CardContent>
      <Button iconLeft="plus">Create project</Button>
    </Card>
  );
}
```

`FormField` wires up label, input, error, and description with the correct `id`, `aria-invalid`, and `aria-describedby` plumbing. Render the input through `FormFieldInput` to inherit those props automatically:

```tsx
import {FormField, FormFieldInput} from '@shipfox/react-ui';

<FormField label="Email" id="email" error={error}>
  <FormFieldInput type="email" value={value} onChange={...} />
</FormField>
```

## Storybook

Components are documented in Storybook stories under `src/**/*.stories.tsx`:

```sh
pnpm --filter=@shipfox/react-ui storybook
```

Stories are also captured by Argos for visual regression under `turbo test` (light + dark).

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
