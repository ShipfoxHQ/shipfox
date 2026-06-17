import {Code, EmptyState, Text} from '@shipfox/react-ui';

export type WorkflowSourceLineRange = {
  startLine: number;
  endLine: number;
  label?: string;
};

export type WorkflowSourceDocument = {
  content: string | null | undefined;
  format?: string;
  path?: string | null;
};

export type WorkflowSourceViewVariant = 'panel' | 'inline';

export type WorkflowSourceViewProps = {
  source: WorkflowSourceDocument | null | undefined;
  selectedRange?: WorkflowSourceLineRange | null;
  variant?: WorkflowSourceViewVariant | undefined;
  className?: string;
};

type SourceLine = {
  number: number;
  text: string;
};

const TRAILING_NEWLINE_REGEX = /\n$/;
const CRLF_REGEX = /\r\n/g;

export function WorkflowSourceView({
  source,
  selectedRange,
  variant = 'panel',
  className,
}: WorkflowSourceViewProps) {
  const sourceContent = source?.content ?? '';
  const hasSourceContent = sourceContent.trim().length > 0;

  const body = hasSourceContent ? (
    <SourceCodePanel content={sourceContent} selectedRange={selectedRange} />
  ) : (
    <div className="min-h-220">
      <EmptyState
        icon="fileDamageLine"
        title="No source document"
        description="The workflow source snapshot is not available for this run."
        variant="default"
      />
    </div>
  );

  if (variant === 'inline') {
    return (
      <section aria-label="Workflow source" className={className}>
        {body}
      </section>
    );
  }

  return (
    <section
      aria-label="Workflow source"
      className={`overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base${
        className ? ` ${className}` : ''
      }`}
    >
      <div className="flex h-44 items-center justify-between gap-16 border-border-neutral-base border-b px-16">
        <div className="min-w-0">
          <Text size="sm" bold className="truncate">
            Source
          </Text>
          {source?.path ? (
            <Code variant="label" className="truncate text-foreground-neutral-muted">
              {source.path}
            </Code>
          ) : null}
        </div>
        <Code
          as="span"
          variant="label"
          className="shrink-0 rounded-4 border border-border-neutral-base bg-background-components-base px-6 py-2 text-foreground-neutral-muted uppercase"
        >
          {source?.format ?? 'source'}
        </Code>
      </div>

      {body}
    </section>
  );
}

function SourceCodePanel({
  content,
  selectedRange,
}: {
  content: string;
  selectedRange: WorkflowSourceLineRange | null | undefined;
}) {
  const lines = splitSourceLines(content);
  const normalizedRange = normalizeRange(selectedRange, lines.length);

  return (
    <div>
      <div className="flex h-36 items-center justify-between gap-12 border-border-neutral-base border-b bg-background-neutral-background px-16">
        <Text size="xs" className="text-foreground-neutral-muted">
          {normalizedRange
            ? (selectedRange?.label ??
              `Lines ${normalizedRange.startLine}-${normalizedRange.endLine}`)
            : 'No step source location'}
        </Text>
        <Text size="xs" className="text-foreground-neutral-muted tabular-nums">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        </Text>
      </div>
      <section
        aria-label="Workflow source code"
        className="max-h-520 overflow-auto bg-background-contrast-base py-8 scrollbar"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need focus to scroll long source documents.
        tabIndex={0}
      >
        <pre>
          <code className="block min-w-max font-code text-sm leading-20">
            {lines.map((line) => (
              <SourceCodeLine
                key={line.number}
                line={line}
                isHighlighted={isLineInRange(line.number, normalizedRange)}
              />
            ))}
          </code>
        </pre>
      </section>
    </div>
  );
}

function SourceCodeLine({line, isHighlighted}: {line: SourceLine; isHighlighted: boolean}) {
  return (
    <span
      className={`grid grid-cols-[56px_minmax(0,1fr)] border-l-2 pr-16${
        isHighlighted
          ? ' border-border-highlights-interactive bg-background-highlight-base'
          : ' border-transparent'
      }`}
      data-highlighted={isHighlighted ? 'true' : undefined}
    >
      <span
        className={`select-none px-12 text-right tabular-nums${
          isHighlighted
            ? ' text-foreground-highlight-interactive'
            : ' text-foreground-neutral-muted'
        }`}
        aria-hidden="true"
      >
        {line.number}
      </span>
      <span
        className={
          isHighlighted
            ? 'whitespace-pre text-foreground-neutral-base'
            : 'whitespace-pre text-foreground-neutral-on-inverted dark:text-foreground-neutral-base'
        }
      >
        {line.text || ' '}
      </span>
    </span>
  );
}

function splitSourceLines(content: string): SourceLine[] {
  const lines = content.replace(CRLF_REGEX, '\n').replace(TRAILING_NEWLINE_REGEX, '').split('\n');
  return lines.map((text, index) => ({number: index + 1, text}));
}

function normalizeRange(
  range: WorkflowSourceLineRange | null | undefined,
  lineCount: number,
): WorkflowSourceLineRange | null {
  if (!range) return null;

  const startLine = Math.floor(range.startLine);
  const endLine = Math.floor(range.endLine);

  if (
    !Number.isFinite(startLine) ||
    !Number.isFinite(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    startLine > lineCount
  ) {
    return null;
  }

  return {
    startLine,
    endLine: Math.min(lineCount, endLine),
    ...(range.label ? {label: range.label} : {}),
  };
}

function isLineInRange(lineNumber: number, range: WorkflowSourceLineRange | null) {
  return range ? lineNumber >= range.startLine && lineNumber <= range.endLine : false;
}
