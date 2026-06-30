import type {AgentProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
import {
  Button,
  Code,
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  Combobox,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
  useCopyToClipboard,
} from '@shipfox/react-ui';
import {useEffect, useMemo, useRef, useState} from 'react';
import {buildAgentWorkflowExample} from './agent-workflow-example.js';

type CopyState = 'idle' | 'copied' | 'failed';

const WORKFLOW_EXAMPLE_FILENAME = '.shipfox/workflows/agent.yml';

export function AgentProviderUsageModal({
  entry,
  initialModel,
  open,
  onOpenChange,
  closeFocusTarget,
}: {
  entry: AgentProviderCatalogEntryDto | null;
  initialModel?: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeFocusTarget?: HTMLElement | null | undefined;
}) {
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    if (!entry) return;
    setSelectedModel(initialModel ?? entry.default_model ?? entry.models[0]?.id ?? '');
  }, [entry, initialModel]);

  const modelOptions = useMemo(
    () => entry?.models.map((model) => ({value: model.id, label: model.label})) ?? [],
    [entry],
  );
  const example = entry
    ? buildAgentWorkflowExample({providerId: entry.id, model: selectedModel})
    : null;
  const data =
    example === null
      ? []
      : [{language: 'yaml', filename: WORKFLOW_EXAMPLE_FILENAME, code: example.code}];

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen && closeFocusTarget) {
      window.setTimeout(() => closeFocusTarget.focus(), 0);
    }
  }

  return (
    <Modal open={open && entry !== null} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined} className="max-w-[640px]">
        <ModalTitle className="sr-only">
          {entry ? `Use ${entry.label} in a workflow` : 'Use provider in a workflow'}
        </ModalTitle>
        <ModalHeader>
          <div className="flex min-w-0 flex-col gap-2">
            <Text size="lg" aria-hidden="true" className="truncate">
              {entry ? `Use ${entry.label} in a workflow` : 'Use provider in a workflow'}
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              Reference this provider from a workflow agent step.
            </Text>
          </div>
        </ModalHeader>
        {entry && example ? (
          <>
            <ModalBody className="gap-0">
              <div className="flex max-h-[70vh] w-full flex-col gap-16 overflow-y-auto pr-2 scrollbar">
                <div className="flex flex-col gap-6">
                  <Text size="sm" bold>
                    Model
                  </Text>
                  <Combobox
                    aria-label="Model"
                    options={modelOptions}
                    value={selectedModel}
                    onValueChange={(value) => {
                      if (value) setSelectedModel(value);
                    }}
                    placeholder="Select model..."
                    searchPlaceholder="Search models..."
                    emptyState="No model found."
                    className="w-full"
                  />
                </div>

                <CodeBlock data={data} className="h-auto min-h-0 rounded-8">
                  <CodeBlockHeader>
                    <CodeBlockFiles>
                      {(item) => (
                        <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>
                      )}
                    </CodeBlockFiles>
                    <CodeBlockCopyButton />
                  </CodeBlockHeader>
                  <CodeBlockBody className="overflow-auto scrollbar">
                    {(item) => (
                      <CodeBlockItem value={item.filename}>
                        <CodeBlockContent
                          language="yaml"
                          syntaxHighlighting
                          highlightedLineRange={example.highlightedLineRange}
                        >
                          {item.code}
                        </CodeBlockContent>
                      </CodeBlockItem>
                    )}
                  </CodeBlockBody>
                </CodeBlock>

                <Text size="sm" className="text-foreground-neutral-muted">
                  Add this to a workflow file under{' '}
                  <Code as="span" variant="label">
                    .shipfox/workflows/
                  </Code>{' '}
                  in your repository to run it.
                </Text>

                <div className="flex flex-col gap-8">
                  <Text size="sm" bold>
                    Available models ({entry.models.length})
                  </Text>
                  <ul className="max-h-240 overflow-auto rounded-8 border border-border-neutral-base scrollbar">
                    {entry.models.map((model) => (
                      <AgentProviderModelRow key={model.id} label={model.label} id={model.id} />
                    ))}
                  </ul>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function AgentProviderModelRow({label, id}: {label: string; id: string}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: id,
    onCopy: () => {
      setTemporaryCopyState('copied');
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function setTemporaryCopyState(state: Exclude<CopyState, 'idle'>) {
    setCopyState(state);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopyState('idle'), 2500);
  }

  async function handleCopy() {
    try {
      await copy();
    } catch {
      setTemporaryCopyState('failed');
    }
  }

  return (
    <li className="flex items-center gap-12 border-b border-border-neutral-base px-12 py-10 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Text size="sm" bold className="truncate">
          {label}
        </Text>
        <Code as="p" variant="label" className="truncate text-foreground-neutral-muted">
          {id}
        </Code>
      </div>
      <IconButton
        type="button"
        size="sm"
        variant="transparent"
        icon={copyState === 'copied' ? 'check' : copyState === 'failed' ? 'xCircleSolid' : 'copy'}
        aria-label={`Copy ${label} id`}
        onClick={() => {
          void handleCopy();
        }}
      />
      {copyState === 'copied' ? (
        <span className="sr-only" role="status">
          Copied {label} id
        </span>
      ) : null}
      {copyState === 'failed' ? (
        <span className="sr-only" role="status">
          Could not copy {label} id
        </span>
      ) : null}
    </li>
  );
}
