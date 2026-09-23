'use client';

import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type Ref,
  useContext,
  useMemo,
} from 'react';
import {useMediaQuery} from '#hooks/useMediaQuery.js';
import {cn} from '#utils/cn.js';
import {Button} from '../button/index.js';
import {Icon} from '../icon/index.js';
import {Sheet, SheetContent, SheetDescription, SheetTitle} from '../sheet/index.js';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '../tabs/index.js';
import {Tooltip, TooltipContent, TooltipTrigger} from '../tooltip/index.js';
import {Text} from '../typography/index.js';

/** The width at which an inspector docks beside the workspace instead of opening as a sheet. */
export const INSPECTOR_DOCK_QUERY = '(min-width: 1024px)';

/**
 * - `responsive` docks at `lg` and wider and opens as a sheet below.
 * - `docked` always renders beside the workspace.
 * - `sheet` always opens as a modal sheet, for an inspector opened from a list.
 */
export type InspectorPresentation = 'responsive' | 'docked' | 'sheet';

interface InspectorContextValue {
  docked: boolean;
  onClose: () => void;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

function useInspectorContext(component: string): InspectorContextValue {
  const context = useContext(InspectorContext);
  if (!context) throw new Error(`${component} must be rendered inside an Inspector.`);
  return context;
}

export interface InspectorProps {
  /** Accessible name of the docked landmark. The sheet takes its name from the header title. */
  label: string;
  onClose: () => void;
  open?: boolean | undefined;
  presentation?: InspectorPresentation | undefined;
  children: ReactNode;
}

/**
 * Supporting data beside the workspace it explains. Docked, it keeps the
 * workspace visible with no backdrop or focus trap; as a sheet, it is modal.
 * Mount one inspector per breakpoint, never both.
 */
export function Inspector({
  label,
  onClose,
  open = true,
  presentation = 'responsive',
  children,
}: InspectorProps) {
  const wide = useMediaQuery(INSPECTOR_DOCK_QUERY);
  const docked = presentation === 'docked' || (presentation === 'responsive' && wide);
  const context = useMemo(() => ({docked, onClose}), [docked, onClose]);
  const content = (
    <InspectorContext.Provider value={context}>
      <div data-slot="inspector" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </InspectorContext.Provider>
  );

  if (docked) {
    if (!open) return null;
    return (
      <aside
        aria-label={label}
        data-presentation="docked"
        className="flex min-h-0 w-[440px] max-w-[42vw] shrink-0 flex-col border-l border-border-neutral-strong bg-background-inspector-base"
      >
        {content}
      </aside>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="right"
        data-presentation="sheet"
        className="w-full bg-background-inspector-base sm:max-w-[560px]"
      >
        {content}
      </SheetContent>
    </Sheet>
  );
}

export interface InspectorHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** A status pill leading the title: color plus word, no glyph. */
  status?: ReactNode;
  /** Chips that qualify the title, such as a sensitivity badge. */
  badges?: ReactNode;
  /** The heading receives focus when the inspector opens; the caller owns when. */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** The facts row, built from `InspectorFacts`. */
  children?: ReactNode;
}

/** Identity and status together, then the facts that qualify them. */
export function InspectorHeader({
  title,
  description,
  status,
  badges,
  headingRef,
  children,
}: InspectorHeaderProps) {
  const {docked, onClose} = useInspectorContext('InspectorHeader');
  // A sheet is a Radix dialog, so its title and description must be the dialog's own parts.
  const Title = docked ? 'h2' : SheetTitle;
  const Description = docked ? 'p' : SheetDescription;

  return (
    <header
      data-slot="inspector-header"
      className="flex shrink-0 flex-col gap-inline border-b border-border-neutral-strong px-panel-compact py-row"
    >
      <div className="flex min-w-0 items-start justify-between gap-cluster">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-inline">
            {status ? <span className="flex shrink-0 self-start">{status}</span> : null}
            <Title
              ref={headingRef}
              tabIndex={-1}
              className="truncate text-lg font-medium leading-28 text-foreground-neutral-base outline-none"
            >
              {title}
            </Title>
          </div>
          {description || badges ? (
            <div className="flex min-w-0 flex-wrap items-center gap-inline">
              {description ? (
                <Description className="truncate text-xs leading-20 text-foreground-neutral-subtle">
                  {description}
                </Description>
              ) : null}
              {badges}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="transparentMuted"
          size="xs"
          aria-label="Close inspector"
          className="size-24 px-0"
          onClick={onClose}
        >
          <Icon name="close" className="size-16" aria-hidden="true" />
        </Button>
      </div>
      {children}
    </header>
  );
}

/** One line of compact facts under the title, divided by `InspectorFactSeparator`. */
export function InspectorFacts({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inspector-facts"
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-inline gap-y-tight text-xs [&:empty]:hidden',
        className,
      )}
      {...props}
    />
  );
}

export interface InspectorFactProps {
  icon: ReactNode;
  /** Precise detail shown in a tooltip and used as the accessible name. Omit it for a self-explanatory value. */
  description?: string | undefined;
  children: ReactNode;
}

/** An icon and a monospace value. */
export function InspectorFact({icon, description, children}: InspectorFactProps) {
  const fact = (
    <span
      data-slot="inspector-fact"
      {...(description ? {role: 'img', 'aria-label': description} : {})}
      className="inline-flex min-w-0 max-w-full items-center gap-tight text-xs text-foreground-neutral-subtle"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-12 shrink-0 items-center text-foreground-neutral-muted [&_svg]:size-12"
      >
        {icon}
      </span>
      <span className="min-w-0 break-words font-code text-xs leading-20">{children}</span>
    </span>
  );
  if (!description) return fact;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{fact}</TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs" className="block max-w-[360px] break-words">
          {description}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function InspectorFactSeparator() {
  return (
    <span
      aria-hidden="true"
      data-slot="inspector-fact-separator"
      className="h-12 w-px shrink-0 bg-border-neutral-base"
    />
  );
}

export interface InspectorTab {
  value: string;
  label: string;
  /** Shown after the label when the tab lists items. */
  count?: number | undefined;
  content: ReactNode;
}

export interface InspectorTabsProps {
  tabs: readonly InspectorTab[];
  /** Accessible name of the tab list. */
  label?: string | undefined;
}

/** Scope-specific tabs. Each tab body scrolls on its own and holds full-width sections. */
export function InspectorTabs({tabs, label = 'Inspector sections'}: InspectorTabsProps) {
  const first = tabs[0]?.value ?? '';
  return (
    <Tabs defaultValue={first} className="min-h-0 flex-1 gap-0">
      <div className="scrollbar shrink-0 overflow-x-auto border-b border-border-neutral-strong px-panel-compact">
        <TabsList aria-label={label} className="min-w-max">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-tight">
              {tab.label}
              {tab.count ? ' ' : null}
              {tab.count ? (
                <span className="tabular-nums text-foreground-neutral-muted">{tab.count}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="scrollbar min-h-0 flex-1 overflow-y-auto"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The scrolling body of an inspector without tabs. It holds full-width sections. */
export function InspectorBody({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inspector-body"
      className={cn('scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto', className)}
      {...props}
    />
  );
}

/**
 * A tab-level line above the first section, for state that covers the whole
 * tab: loading, a failed refresh, or nothing recorded. Plain text renders muted.
 */
export function InspectorNotice({className, children, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inspector-notice"
      className={cn('px-panel-compact py-row', className)}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text size="xs" className="text-foreground-neutral-muted">
          {children}
        </Text>
      ) : (
        children
      )}
    </div>
  );
}
