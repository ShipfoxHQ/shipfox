'use client';

import type {ComponentProps, ReactNode} from 'react';
import {useEffect, useId, useRef, useState} from 'react';
import {useCopyToClipboard} from '#hooks/useCopyToClipboard.js';
import {cn} from '#utils/cn.js';
import {Badge} from '../badge/index.js';
import {IconButton} from '../button/index.js';
import {Icon} from '../icon/index.js';
import {Text} from '../typography/index.js';

/**
 * A full-width inspector section: a canvas header band over one body block.
 * An inspector is already one surface, so a section is never a bordered card.
 */
export interface InspectorSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  /** Item count shown after the title when the body lists items. */
  count?: number | undefined;
  /** The single band aside: an outcome chip, a type chip, a total, or one action. */
  aside?: ReactNode;
  /**
   * Makes the band a disclosure with a leading chevron. The body renders only
   * while the section is open.
   */
  defaultOpen?: boolean | undefined;
}

export function InspectorSection({
  title,
  count,
  aside,
  defaultOpen,
  className,
  children,
  ...props
}: InspectorSectionProps) {
  const collapsible = defaultOpen !== undefined;
  const [open, setOpen] = useState(defaultOpen ?? true);
  const bodyId = useId();
  const titleId = useId();
  const heading = (
    <>
      <span id={titleId} className="min-w-0 truncate text-foreground-neutral-base">
        {title}
      </span>
      {count === undefined ? null : (
        <span className="shrink-0 tabular-nums text-foreground-neutral-muted">{count}</span>
      )}
    </>
  );

  return (
    <section
      data-slot="inspector-section"
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col border-t border-border-neutral-base first:border-t-0',
        className,
      )}
      {...props}
    >
      <div
        data-slot="inspector-section-band"
        className={cn(
          'flex min-h-32 min-w-0 items-center justify-between gap-inline bg-background-inspector-band px-panel-compact py-tight',
          (!collapsible || open) && 'border-b border-border-neutral-base',
        )}
      >
        <Text as="h3" size="xs" bold className="flex min-w-0 items-baseline gap-tight">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen((current) => !current)}
              className="flex min-w-0 cursor-pointer items-center gap-tight rounded-4 outline-none focus-visible:shadow-focus-inset"
            >
              <DisclosureChevron open={open} />
              {heading}
            </button>
          ) : (
            heading
          )}
        </Text>
        {aside ? <div className="flex shrink-0 items-center gap-tight">{aside}</div> : null}
      </div>
      {collapsible ? (
        <div id={bodyId} hidden={!open} className="flex min-w-0 flex-col">
          {open ? children : null}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** Padded body for a section block that is not a property list or a table. */
export function InspectorSectionBody({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inspector-section-body"
      className={cn('flex min-w-0 flex-col gap-inline px-panel-compact py-row', className)}
      {...props}
    />
  );
}

/** A section with nothing recorded yet keeps its band and says so in one line. */
export function InspectorSectionEmpty({className, children, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inspector-section-empty"
      className={cn('px-panel-compact py-row', className)}
      {...props}
    >
      <Text size="xs" className="text-foreground-neutral-muted">
        {children}
      </Text>
    </div>
  );
}

export function PropertyList({className, ...props}: ComponentProps<'dl'>) {
  return (
    <dl data-slot="property-list" className={cn('flex min-w-0 flex-col', className)} {...props} />
  );
}

/**
 * One named value. The key stacks above the value so long identifiers and
 * values stay readable at inspector width instead of splitting mid-token.
 */
export interface PropertyRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  label: ReactNode;
  /** Use `code` when the key is an identifier the user wrote. */
  labelFont?: 'display' | 'code';
  /** A type or source chip at the end of the key line. */
  meta?: ReactNode;
  /** Text copied by the hover copy button. Omit it for no copy button. */
  copyValue?: string | undefined;
  /** Accessible name of the copy button. Defaults to `Copy value`. */
  copyLabel?: string | undefined;
  children: ReactNode;
}

export function PropertyRow({
  label,
  labelFont = 'display',
  meta,
  copyValue,
  copyLabel = 'Copy value',
  className,
  children,
  ...props
}: PropertyRowProps) {
  return (
    <div
      data-slot="property-row"
      className={cn(
        'group/property flex min-w-0 flex-col gap-tight border-b border-border-neutral-base px-panel-compact py-row transition-colors last:border-b-0 hover:bg-background-neutral-hover',
        className,
      )}
      {...props}
    >
      <dt className="flex min-h-20 min-w-0 items-start justify-between gap-inline">
        <span
          className={cn(
            'min-w-0 break-words text-xs leading-20 text-foreground-neutral-muted',
            labelFont === 'code' ? 'break-all font-code' : 'font-display',
          )}
        >
          {label}
        </span>
        {meta || copyValue !== undefined ? (
          <span className="flex shrink-0 items-center gap-tight">
            {meta}
            {copyValue === undefined ? null : (
              <PropertyCopyButton value={copyValue} label={copyLabel} />
            )}
          </span>
        ) : null}
      </dt>
      <dd className="min-w-0 break-words font-code text-xs leading-20 text-foreground-neutral-base">
        {children}
      </dd>
    </div>
  );
}

export interface PropertyDisclosureRowProps extends Omit<PropertyRowProps, 'children'> {
  /** Shown as the value while the row is closed, such as a field count. */
  summary: ReactNode;
  /** Accessible name of the toggle. Defaults to the label text. */
  toggleLabel?: string | undefined;
  defaultOpen?: boolean | undefined;
  children: ReactNode;
}

/** A property whose value opens in place behind a leading chevron. */
export function PropertyDisclosureRow({
  label,
  summary,
  toggleLabel,
  defaultOpen = false,
  children,
  ...props
}: PropertyDisclosureRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const valueId = useId();

  return (
    <PropertyRow
      {...props}
      label={
        <button
          type="button"
          aria-expanded={open}
          aria-controls={valueId}
          aria-label={toggleLabel}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex min-w-0 cursor-pointer items-center gap-tight rounded-4 outline-none hover:text-foreground-neutral-base focus-visible:shadow-focus-inset"
        >
          <DisclosureChevron open={open} />
          {label}
        </button>
      }
    >
      <div id={valueId}>
        {open ? children : <span className="text-foreground-neutral-muted">{summary}</span>}
      </div>
    </PropertyRow>
  );
}

/**
 * A code surface flush in a property value, for JSON or multi-line text. It
 * has no header or border: the row already names and frames it.
 */
export function PropertyCode({className, ...props}: ComponentProps<'pre'>) {
  return (
    <pre
      data-slot="property-code"
      className={cn(
        'scrollbar mt-tight max-h-320 min-w-0 overflow-auto rounded-6 bg-background-inspector-value p-tight font-code text-xs leading-20 text-foreground-contrast-primary',
        className,
      )}
      {...props}
    />
  );
}

export interface JsonPropertyListProps {
  value: Record<string, unknown>;
  /** Accessible name of each copy button. Defaults to `Copy <name>`. */
  copyLabel?: ((name: string) => string) | undefined;
  /** Extra rows after the object's properties, such as a disclosure. */
  children?: ReactNode;
}

/**
 * One property row per key of a JSON object: the key in code, a type chip, a
 * copy button, and the value. Nested objects render as a flush code value.
 */
export function JsonPropertyList({
  value,
  copyLabel = (name) => `Copy ${name}`,
  children,
}: JsonPropertyListProps) {
  return (
    <PropertyList>
      {Object.entries(value).map(([name, entry]) => (
        <PropertyRow
          key={name}
          label={name}
          labelFont="code"
          meta={<Badge size="2xs">{jsonValueType(entry)}</Badge>}
          copyValue={serializeJsonValue(entry)}
          copyLabel={copyLabel(name)}
        >
          <JsonPropertyValue value={entry} />
        </PropertyRow>
      ))}
      {children}
    </PropertyList>
  );
}

/** A JSON value as a property value: objects and multi-line text as code, URLs as links. */
export function JsonPropertyValue({value}: {value: unknown}) {
  if (typeof value === 'object' && value !== null) {
    return <PropertyCode>{serializeJsonValue(value)}</PropertyCode>;
  }
  if (typeof value !== 'string') return serializeJsonValue(value);
  const href = safeHttpUrl(value);
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 items-start gap-tight break-all text-foreground-highlight-interactive hover:underline"
      >
        <span>{value}</span>
        <Icon name="externalLink" className="size-12 shrink-0 self-center" aria-hidden="true" />
      </a>
    );
  }
  return value.includes('\n') ? <PropertyCode>{value}</PropertyCode> : value;
}

export function jsonValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function serializeJsonValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? String(value) : serialized;
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function DisclosureChevron({open}: {open: boolean}) {
  return (
    <Icon
      name="chevronRight"
      aria-hidden="true"
      className={cn(
        'size-14 shrink-0 text-foreground-neutral-muted transition-transform motion-reduce:transition-none',
        open && 'rotate-90',
      )}
    />
  );
}

function PropertyCopyButton({value, label}: {value: string; label: string}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: value,
    onCopy: () => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    },
  });

  useEffect(() => () => (timeoutRef.current ? clearTimeout(timeoutRef.current) : undefined), []);

  return (
    <IconButton
      type="button"
      variant="transparent"
      size="2xs"
      icon={copied ? 'check' : 'copy'}
      aria-label={copied ? 'Copied' : label}
      className={cn(
        '[&_svg]:size-12',
        // Revealed on hover and focus; always shown where there is no hover.
        'opacity-0 focus-visible:opacity-100 group-hover/property:opacity-100 [@media(hover:none)]:opacity-100',
        copied && 'opacity-100',
      )}
      onClick={() => void copy().catch(() => undefined)}
    />
  );
}
