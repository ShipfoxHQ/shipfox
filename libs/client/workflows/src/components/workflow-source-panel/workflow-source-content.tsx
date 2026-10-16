import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  type CodeBlockHighlightedLineRange,
  CodeBlockItem,
} from '@shipfox/react-ui/code-block';
import {cn} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import {WORKFLOW_SOURCE_FILENAME} from '#core/composite-step.js';
import type {WorkflowSourceSnapshot} from '#core/workflow-run.js';

const WORKFLOW_SOURCE_CODE_THEMES = {
  light: 'vitesse-dark',
  dark: 'vitesse-dark',
};

export interface WorkflowSourceContentProps {
  source: WorkflowSourceSnapshot;
  highlightedLineRange?: CodeBlockHighlightedLineRange | null | undefined;
  scrollHighlightedIntoView?: boolean | undefined;
  /** The file name shown in the header. Defaults to the workflow file. */
  filename?: string | undefined;
  /** Replaces the file name in the header, for example with a path back to a calling step. */
  breadcrumb?: ReactNode;
  headerAction?: ReactNode;
  className?: string | undefined;
}

export function WorkflowSourceContent({
  source,
  highlightedLineRange,
  scrollHighlightedIntoView,
  filename = WORKFLOW_SOURCE_FILENAME,
  breadcrumb,
  headerAction,
  className,
}: WorkflowSourceContentProps) {
  const data = [
    {
      language: 'yaml',
      filename,
      code: source.content,
    },
  ];

  return (
    <CodeBlock
      data={data}
      className={cn(
        'flex size-full flex-col rounded-none bg-background-contrast-base shadow-none',
        className,
      )}
    >
      <CodeBlockHeader className="shrink-0 border-b border-border-contrast-base bg-background-contrast-base">
        {breadcrumb ?? (
          <CodeBlockFiles>
            {(item) => <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>}
          </CodeBlockFiles>
        )}
        <CodeBlockCopyButton />
        {headerAction}
      </CodeBlockHeader>
      <CodeBlockBody className="flex min-h-0 flex-1 overflow-auto scrollbar">
        {(item) => (
          <CodeBlockItem
            value={item.filename}
            className={cn(
              'min-h-full px-0 pb-0',
              '[&>div]:rounded-none [&>div]:border-0 [&>div]:bg-background-contrast-base',
              '[&_code]:!text-sm [&_code]:!text-foreground-contrast-primary [&_.line]:!text-sm [&_.line]:before:!text-sm [&_.line]:before:!text-foreground-contrast-secondary',
            )}
          >
            <CodeBlockContent
              language="yaml"
              themes={WORKFLOW_SOURCE_CODE_THEMES}
              syntaxHighlighting
              highlightedLineRange={highlightedLineRange}
              scrollHighlightedIntoView={scrollHighlightedIntoView}
            >
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}
