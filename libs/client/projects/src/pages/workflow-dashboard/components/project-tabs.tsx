import {cn} from '@shipfox/react-ui';

const tabs = ['Overview', 'Runs', 'Workflows', 'Triggers', 'Settings'];

export function WorkflowDashboardProjectTabs() {
  return (
    <nav className="flex h-40 items-center gap-4 border-border-neutral-base border-b bg-background-components-base px-16">
      {tabs.map((tab) => (
        <button
          className={cn(
            'flex h-40 items-center border-transparent border-b-2 px-10 text-foreground-neutral-muted text-sm transition-colors hover:text-foreground-neutral-base focus-visible:shadow-button-neutral-focus focus-visible:outline-none',
            tab === 'Runs' && 'border-border-highlights-interactive text-foreground-neutral-base',
          )}
          key={tab}
          type="button"
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}
