import type {WorkflowSourceSnapshotDto} from '@shipfox/api-workflows-dto';
import {
  Button,
  CodeBlock,
  CodeBlockBody,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  cn,
  Header,
  Text,
} from '@shipfox/react-ui';
import type {KeyboardEvent} from 'react';

const WORKFLOW_SOURCE_FILENAME = 'workflow.yaml';

export interface WorkflowSourcePanelProps {
  id: string;
  source: WorkflowSourceSnapshotDto | null;
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
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  }

  return (
    <section
      id={id}
      aria-label="Workflow source"
      aria-hidden={!open}
      onKeyDown={handleKeyDown}
      className={cn(
        'min-h-0 shrink-0 overflow-hidden bg-background-subtle-base transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none',
        open
          ? 'w-[clamp(360px,30vw,420px)] border-l border-border-neutral-base opacity-100'
          : 'w-0 opacity-0',
        className,
      )}
    >
      {open && source ? <WorkflowSourcePanelContent source={source} onClose={onClose} /> : null}
    </section>
  );
}

function WorkflowSourcePanelContent({
  source,
  onClose,
}: {
  source: WorkflowSourceSnapshotDto;
  onClose: () => void;
}) {
  const data = [
    {
      language: 'yaml',
      filename: WORKFLOW_SOURCE_FILENAME,
      code: source.content,
    },
  ];

  return (
    <div className="flex size-full min-w-0 flex-col">
      <div className="flex min-h-52 items-center gap-12 border-b border-border-neutral-base px-16 py-10">
        <div className="min-w-0 flex-1">
          <Header variant="h3" className="truncate">
            Workflow source
          </Header>
          <Text size="xs" className="truncate text-foreground-neutral-subtle">
            {WORKFLOW_SOURCE_FILENAME}
          </Text>
        </div>
        <Button
          type="button"
          variant="transparentMuted"
          size="sm"
          iconLeft="close"
          aria-label="Close source"
          onClick={onClose}
        />
      </div>

      <div className="min-h-0 flex-1 p-12">
        <CodeBlock data={data}>
          <CodeBlockHeader>
            <CodeBlockFiles>
              {(item) => (
                <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>
              )}
            </CodeBlockFiles>
            <CodeBlockCopyButton />
          </CodeBlockHeader>
          <CodeBlockBody className="min-h-0">
            {(item) => (
              <CodeBlockItem value={item.filename} className="h-full">
                <WorkflowSourceCode code={item.code} />
              </CodeBlockItem>
            )}
          </CodeBlockBody>
        </CodeBlock>
      </div>
    </div>
  );
}

function WorkflowSourceCode({code}: {code: string}) {
  return (
    <pre className="w-full font-code">
      <code>
        {sourceLines(code).map(({key, line}) => (
          <span className="line" key={key}>
            {line}
          </span>
        ))}
      </code>
    </pre>
  );
}

function sourceLines(code: string) {
  let offset = 0;
  return code.split('\n').map((line) => {
    const key = `${offset}:${line}`;
    offset += line.length + 1;
    return {key, line};
  });
}
