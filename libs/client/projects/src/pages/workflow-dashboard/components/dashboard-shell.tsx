import {Avatar, Button, Code, Icon, Kbd, Logo, Text} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {WorkflowDashboardProjectTabs} from './project-tabs.js';

export function WorkflowDashboardShell({
  children,
  footerAction,
}: {
  children: ReactNode;
  footerAction?: ReactNode;
}) {
  return (
    <div className="grid h-screen grid-rows-[56px_40px_1fr] overflow-hidden bg-background-neutral-background text-foreground-neutral-base">
      <WorkflowDashboardTopNav />
      <WorkflowDashboardProjectTabs />
      <div className="min-h-0 overflow-hidden">{children}</div>
      {footerAction}
    </div>
  );
}

function WorkflowDashboardTopNav() {
  return (
    <header className="flex items-center justify-between gap-12 border-border-neutral-base border-b bg-background-components-base px-16">
      <div className="flex min-w-0 items-center gap-8">
        <Logo className="h-18 w-auto shrink-0" variant="wordmark" />
        <span className="text-foreground-neutral-disabled text-lg">/</span>
        <button
          className="flex h-28 items-center gap-4 rounded-6 px-6 text-foreground-neutral-base text-sm hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
          type="button"
        >
          <Text as="span" size="sm" bold>
            Acme
          </Text>
          <Icon name="arrowDownSLine" className="size-14 text-foreground-neutral-muted" />
        </button>
        <span className="text-foreground-neutral-disabled text-lg">/</span>
        <button
          className="flex h-28 min-w-0 items-center gap-4 rounded-6 px-6 text-foreground-neutral-base hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
          type="button"
        >
          <Code as="span" variant="label" className="truncate">
            checkout-api
          </Code>
          <Icon name="arrowDownSLine" className="size-14 shrink-0 text-foreground-neutral-muted" />
        </button>
      </div>
      <div className="flex items-center gap-6">
        <button
          className="hidden h-28 items-center gap-8 rounded-6 border border-border-neutral-base bg-background-components-base px-10 text-foreground-neutral-muted text-xs shadow-button-neutral hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none sm:flex"
          type="button"
        >
          <Icon name="searchLine" className="size-14" />
          <span>Search runs, steps, commits...</span>
          <Kbd className="h-18 min-w-18 px-3">/</Kbd>
        </button>
        <Button size="sm" variant="transparentMuted" iconLeft="bookOpen" aria-label="Docs" />
        <Avatar size="sm" content="letters" fallback="TA" />
      </div>
    </header>
  );
}
