import {
  Button,
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  cn,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@shipfox/react-ui';
import type {WorkflowSourceSnapshot} from '#core/workflow-run.js';

const WORKFLOW_SOURCE_FILENAME = 'workflow.yaml';
const WORKFLOW_SOURCE_CODE_THEMES = {
  light: 'vitesse-dark',
  dark: 'vitesse-dark',
};

export interface WorkflowSourcePanelProps {
  id: string;
  source: WorkflowSourceSnapshot | null;
  open: boolean;
  onClose: () => void;
  className?: string | undefined;
}

export function WorkflowSourcePanel({
  id,
  source,
  open,
  onClose,
  className,
}: WorkflowSourcePanelProps) {
  const sheetOpen = open && source !== null;

  if (!sheetOpen) return null;

  return (
    <Sheet
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      {source ? (
        <SheetContent
          id={id}
          side="right"
          aria-describedby={undefined}
          className={cn(
            'w-screen max-w-none border-l-0 bg-background-contrast-base p-0 shadow-none sm:w-[min(85vw,1120px)] sm:max-w-none [&_.shadow-separator-inset]:shadow-none',
            className,
          )}
        >
          <SheetTitle className="sr-only">Workflow source</SheetTitle>
          <WorkflowSourcePanelContent source={source} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function WorkflowSourcePanelContent({source}: {source: WorkflowSourceSnapshot}) {
  const data = [
    {
      language: 'yaml',
      filename: WORKFLOW_SOURCE_FILENAME,
      code: source.content,
    },
  ];

  return (
    <CodeBlock
      data={data}
      className="flex size-full flex-col rounded-none bg-background-contrast-base shadow-none"
    >
      <CodeBlockHeader className="shrink-0 border-b border-border-contrast-base bg-background-contrast-base">
        <CodeBlockFiles>
          {(item) => <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
        <SheetClose asChild>
          <Button
            type="button"
            variant="transparentMuted"
            size="sm"
            iconLeft="close"
            aria-label="Close source"
          />
        </SheetClose>
      </CodeBlockHeader>
      <CodeBlockBody className="flex min-h-0 flex-1 overflow-auto scrollbar">
        {(item) => (
          <CodeBlockItem
            value={item.filename}
            className={cn(
              'min-h-full px-0 pb-0',
              '[&>div]:rounded-none [&>div]:border-0 [&>div]:bg-background-contrast-base [&>div]:dark:bg-background-contrast-base',
              '[&_code]:!text-sm [&_code]:!text-foreground-neutral-on-inverted [&_.line]:!text-sm [&_.line]:before:!text-sm [&_.line]:before:!text-foreground-neutral-muted',
            )}
          >
            <CodeBlockContent
              language="yaml"
              themes={WORKFLOW_SOURCE_CODE_THEMES}
              syntaxHighlighting
            >
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}
