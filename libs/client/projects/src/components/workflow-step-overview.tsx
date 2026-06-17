import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Code,
  EmptyState,
  StatusBadge,
  Text,
} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {
  toWorkflowStepOverviewModel,
  type WorkflowStepSelection,
} from './workflow-step-overview-model.js';

export type WorkflowStepOverviewVariant = 'panel' | 'inline';

export function WorkflowStepOverview({
  selection,
  variant = 'panel',
}: {
  selection: WorkflowStepSelection | null;
  variant?: WorkflowStepOverviewVariant | undefined;
}) {
  const model = toWorkflowStepOverviewModel(selection);
  const isInline = variant === 'inline';

  return (
    <section
      aria-label="Step overview"
      className={
        isInline
          ? 'flex flex-col'
          : 'flex min-h-560 flex-col rounded-8 border border-border-neutral-base bg-background-neutral-base'
      }
    >
      {model === null ? (
        <div
          className={
            isInline
              ? 'flex items-center justify-center px-24 py-32'
              : 'flex min-h-560 items-center justify-center px-24'
          }
        >
          <EmptyState
            icon="componentLine"
            title="Select a step"
            description="Choose a step from the run to inspect its command, attempts, and current result."
          />
        </div>
      ) : (
        <>
          <div
            className={
              isInline
                ? 'flex items-start justify-between gap-16 border-b border-border-neutral-base py-12'
                : 'flex items-start justify-between gap-16 border-b border-border-neutral-base px-20 py-20'
            }
          >
            <div className="flex min-w-0 flex-col gap-8">
              <div className="flex flex-wrap items-center gap-8">
                <Code as="h3" variant="paragraph" bold className="min-w-0 text-lg">
                  {model.stepName}
                </Code>
                <StatusBadge variant={model.statusVariant}>{model.statusLabel}</StatusBadge>
              </div>
              <div className="flex flex-wrap items-center gap-8">
                <Code variant="label" className="text-foreground-neutral-muted">
                  {model.jobName}
                </Code>
                <Code variant="label" className="text-foreground-neutral-muted">
                  {model.positionLabel}
                </Code>
                <Code variant="label" className="text-foreground-neutral-muted">
                  {model.stepType}
                </Code>
              </div>
            </div>
            {model.currentAttempt ? (
              <div className="shrink-0">
                <StatusBadge variant={model.currentAttempt.statusVariant}>
                  Attempt #{model.currentAttempt.attempt}
                </StatusBadge>
              </div>
            ) : null}
          </div>

          <div
            className={
              isInline ? 'flex flex-1 flex-col gap-16 py-16' : 'flex flex-1 flex-col gap-20 p-20'
            }
          >
            {model.summary ? (
              <Alert variant={model.summary.tone} animated={false}>
                <AlertContent>
                  <AlertTitle>{model.summary.title}</AlertTitle>
                  <AlertDescription className="space-y-8">
                    <p>{model.summary.body}</p>
                    {model.summary.details ? (
                      <Code
                        as="pre"
                        variant="paragraph"
                        className="overflow-x-auto rounded-6 border border-border-neutral-base bg-background-neutral-base px-12 py-10 whitespace-pre-wrap"
                      >
                        {model.summary.details}
                      </Code>
                    ) : null}
                  </AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}

            {model.command ? (
              <OverviewSection title="Command">
                <Code
                  as="pre"
                  variant="paragraph"
                  className="overflow-x-auto rounded-6 border border-border-neutral-base bg-background-components-base px-12 py-10 whitespace-pre-wrap"
                >
                  {model.command}
                </Code>
              </OverviewSection>
            ) : null}

            {model.attempts.length > 0 ? (
              <OverviewSection title={model.attempts.length === 1 ? 'Attempt' : 'Attempts'}>
                <div className="flex flex-col gap-10">
                  {model.attempts.map((attempt) => (
                    <div
                      key={attempt.id}
                      className={`rounded-6 border px-12 py-10 ${
                        attempt.isCurrent
                          ? 'border-border-neutral-strong bg-background-components-hover'
                          : 'border-border-neutral-base bg-background-components-base'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-8">
                        <div className="flex flex-wrap items-center gap-8">
                          <Text size="sm" bold>
                            #{attempt.attempt}
                          </Text>
                          <StatusBadge variant={attempt.statusVariant}>
                            {attempt.statusLabel}
                          </StatusBadge>
                          {attempt.isCurrent ? (
                            <Text size="xs" className="text-foreground-neutral-muted">
                              Current projection
                            </Text>
                          ) : null}
                        </div>
                        <Code variant="label" className="text-foreground-neutral-muted">
                          {attempt.exitCodeLabel}
                        </Code>
                      </div>
                      <div className="mt-8 flex flex-wrap gap-x-16 gap-y-4">
                        <MetadataPair label="Started" value={attempt.startedAtLabel} />
                        <MetadataPair label="Finished" value={attempt.finishedAtLabel} />
                      </div>
                      {attempt.restartReason ? (
                        <div className="mt-8 flex flex-col gap-4">
                          <Text size="xs" className="text-foreground-neutral-muted">
                            Restart reason
                          </Text>
                          <Code
                            variant="paragraph"
                            className="rounded-6 border border-border-neutral-base bg-background-neutral-base px-12 py-10 whitespace-pre-wrap"
                          >
                            {attempt.restartReason}
                          </Code>
                        </div>
                      ) : null}
                      <AttemptEntries title="Gate result" entries={attempt.gateResultEntries} />
                      <AttemptEntries
                        title="Restart result"
                        entries={attempt.restartResultEntries}
                      />
                    </div>
                  ))}
                </div>
              </OverviewSection>
            ) : null}

            {model.outputEntries.length > 0 ? (
              <OverviewSection title="Output">
                <div className="overflow-hidden rounded-6 border border-border-neutral-base">
                  {model.outputEntries.map((entry, index) => (
                    <div
                      key={entry.key}
                      className={`grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-12 px-12 py-10 ${
                        index === 0 ? 'border-t-0' : 'border-t border-border-neutral-base'
                      }`}
                    >
                      <Text size="xs" className="text-foreground-neutral-muted">
                        {entry.key}
                      </Text>
                      <Code variant="paragraph" className="whitespace-pre-wrap break-words">
                        {entry.value}
                      </Code>
                    </div>
                  ))}
                </div>
              </OverviewSection>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function OverviewSection({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-8">
      <Text size="xs" className="font-medium uppercase text-foreground-neutral-muted">
        {title}
      </Text>
      {children}
    </div>
  );
}

function MetadataPair({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-center gap-6">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Code variant="label">{value}</Code>
    </div>
  );
}

function AttemptEntries({
  title,
  entries,
}: {
  title: string;
  entries: {key: string; value: string}[];
}) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-8 flex flex-col gap-6">
      <Text size="xs" className="font-medium text-foreground-neutral-muted">
        {title}
      </Text>
      <div className="overflow-hidden rounded-6 border border-border-neutral-base">
        {entries.map((entry, index) => (
          <div
            key={entry.key}
            className={`grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-12 px-12 py-10 ${
              index === 0 ? 'border-t-0' : 'border-t border-border-neutral-base'
            }`}
          >
            <Text size="xs" className="text-foreground-neutral-muted">
              {entry.key}
            </Text>
            <Code variant="paragraph" className="whitespace-pre-wrap break-words">
              {entry.value}
            </Code>
          </div>
        ))}
      </div>
    </div>
  );
}
