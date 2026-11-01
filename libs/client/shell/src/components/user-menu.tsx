import {Avatar} from '@shipfox/react-ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSegmentedRadioGroup,
  DropdownMenuSegmentedRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {useTheme} from '@shipfox/react-ui/hooks';
import type {IconName} from '@shipfox/react-ui/icon';
import type {Theme} from '@shipfox/react-ui/theme';
import {Link, useLocation} from '@tanstack/react-router';
import {useMemo} from 'react';
import {useAuthState} from '#runtime/auth.js';
import {useChrome} from '#runtime/chrome-context.js';
import {
  type ShippyPlacement,
  useProjectDockContribution,
  useShippyPlacement,
} from '#runtime/project-dock.js';
import {ReportErrorBoundary} from '#runtime/report-error-boundary.js';

const themeOptions: Array<{value: Theme; label: string; icon: IconName}> = [
  {value: 'light', label: 'Light', icon: 'sunLine'},
  {value: 'dark', label: 'Dark', icon: 'moonLine'},
  {value: 'system', label: 'System', icon: 'computerLine'},
];

const shippyPlacementOptions: Array<{value: ShippyPlacement; label: string; icon: IconName}> = [
  {value: 'floating', label: 'Floating', icon: 'pictureInPicture2Line'},
  {value: 'tab_bar', label: 'Tab bar', icon: 'layoutTopLine'},
];

function ShippyPlacementControl() {
  const {placement, canFloat, setPlacement} = useShippyPlacement();
  // Narrow screens always use the tab bar, so the choice would do nothing there.
  if (!canFloat) return null;
  return (
    <DropdownMenuSegmentedRadioGroup
      label="Shippy"
      value={placement}
      onValueChange={(value) => setPlacement(value as ShippyPlacement)}
    >
      {shippyPlacementOptions.map((option) => (
        <DropdownMenuSegmentedRadioItem
          key={option.value}
          value={option.value}
          icon={option.icon}
          label={option.label}
        />
      ))}
    </DropdownMenuSegmentedRadioGroup>
  );
}

export function UserMenu() {
  const {user} = useAuthState();
  const {AccountMenuEntry} = useChrome();
  const {theme, setTheme} = useTheme();
  const dock = useProjectDockContribution();
  const location = useLocation();
  const email = user?.email ?? '';
  // Retry the account-menu slot only when the route or the slot identity
  // changes, matching the session-banner boundary: the key stays referentially
  // stable across rerenders so a persistently failing slot latches instead of
  // being retried in a loop.
  const accountMenuRetryKey = useMemo(
    () => ({href: location.href, slot: AccountMenuEntry}),
    [location.href, AccountMenuEntry],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          className="rounded-full focus-visible:outline-none focus-visible:shadow-button-neutral-focus"
        >
          <Avatar size="sm" content="letters" fallback={email} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[220px]">
        <DropdownMenuLabel className="text-xs text-foreground-neutral-muted truncate">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSegmentedRadioGroup
          label="Theme"
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
        >
          {themeOptions.map((option) => (
            <DropdownMenuSegmentedRadioItem
              key={option.value}
              value={option.value}
              icon={option.icon}
              label={option.label}
            />
          ))}
        </DropdownMenuSegmentedRadioGroup>
        {dock ? <ShippyPlacementControl /> : undefined}
        {AccountMenuEntry ? (
          <ReportErrorBoundary
            label="Failed to render account menu entry."
            retryKey={accountMenuRetryKey}
          >
            <AccountMenuEntry />
          </ReportErrorBoundary>
        ) : undefined}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={'/auth/logout' as never}>Logout</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
