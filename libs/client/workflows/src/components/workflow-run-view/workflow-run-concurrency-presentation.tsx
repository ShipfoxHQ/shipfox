import {AnnotationCard} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent} from '@shipfox/react-ui/callout';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody, PanelHeader, PanelRow, PanelTitle} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';
import type {
  WorkflowRunAttemptReference,
  WorkflowRunConcurrency,
  WorkflowRunStatus,
} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {useWorkflowRunAttemptReferenceQueries} from '#hooks/api/workflow-run-overview.js';

interface WorkflowRunConcurrencyPresentationProps {
  run: {
    name: string;
    runAttempt: {
      status: WorkflowRunStatus;
      concurrency: WorkflowRunConcurrency | null;
    };
  };
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}

export function WorkflowRunWaitingNotice({
  run,
  workspaceSlug,
  projectSlug,
}: WorkflowRunConcurrencyPresentationProps) {
  const concurrency = visibleConcurrency(
    run.runAttempt.status,
    run.runAttempt.concurrency,
    'waiting',
  );
  if (!concurrency) return null;

  return (
    <WorkflowRunWaitingNoticeContent
      concurrency={concurrency}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
    />
  );
}

function WorkflowRunWaitingNoticeContent({
  concurrency,
  workspaceSlug,
  projectSlug,
}: {
  concurrency: WorkflowRunConcurrency;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  const reference = useConcurrencyReference(concurrency);

  return (
    <div className="px-row pb-row">
      <Callout role="status" aria-live="polite" type="warning">
        <CalloutContent>
          <Text size="sm">
            This workflow is waiting for{' '}
            {reference ? (
              <WorkflowRunReferenceLink
                reference={reference}
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
              />
            ) : (
              'another workflow run'
            )}{' '}
            to complete before running.
          </Text>
        </CalloutContent>
      </Callout>
    </div>
  );
}

export function WorkflowRunSupersededAnnotation({
  run,
  workspaceSlug,
  projectSlug,
}: WorkflowRunConcurrencyPresentationProps) {
  const concurrency = visibleConcurrency(
    run.runAttempt.status,
    run.runAttempt.concurrency,
    'superseded',
  );
  if (!concurrency) return null;

  return (
    <WorkflowRunSupersededAnnotationContent
      runName={run.name}
      concurrency={concurrency}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
    />
  );
}

function WorkflowRunSupersededAnnotationContent({
  runName,
  concurrency,
  workspaceSlug,
  projectSlug,
}: {
  runName: string;
  concurrency: WorkflowRunConcurrency;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  const reference = useConcurrencyReference(concurrency);

  return (
    <Panel asChild>
      <section aria-labelledby="workflow-superseded-annotation-heading">
        <PanelHeader>
          <PanelTitle as="h2" id="workflow-superseded-annotation-heading" variant="h4">
            Annotation
          </PanelTitle>
        </PanelHeader>
        <PanelBody asChild>
          <ol>
            <PanelRow
              asChild
              className="items-start justify-start hover:bg-background-neutral-base"
            >
              <li aria-live="polite" aria-atomic="true">
                <AnnotationCard
                  style="warning"
                  title={runName}
                  titleAs="h3"
                  provenance={
                    <Text as="p" size="xs" className="font-code text-foreground-neutral-subtle">
                      Cancelled
                    </Text>
                  }
                  body={
                    reference
                      ? `Cancelled because ${workflowRunReferenceLabel(reference)} took priority.`
                      : 'Cancelled because a newer workflow run took priority.'
                  }
                  bodyFormat="plain-text"
                  action={
                    reference && workspaceSlug && projectSlug ? (
                      <Button asChild size="xs" variant="transparent">
                        <WorkflowRunReferenceLink
                          reference={reference}
                          workspaceSlug={workspaceSlug}
                          projectSlug={projectSlug}
                          label="View newer run"
                        >
                          <Icon name="arrowRightLine" size={12} aria-hidden="true" />
                        </WorkflowRunReferenceLink>
                      </Button>
                    ) : undefined
                  }
                />
              </li>
            </PanelRow>
          </ol>
        </PanelBody>
      </section>
    </Panel>
  );
}

function useConcurrencyReference(
  concurrency: WorkflowRunConcurrency,
): WorkflowRunAttemptReference | undefined {
  const queries = useWorkflowRunAttemptReferenceQueries(concurrency.affectedAttempts.slice(0, 1));
  return queries[0]?.data ?? undefined;
}

export function WorkflowRunReferenceLink({
  reference,
  workspaceSlug,
  projectSlug,
  label,
  children,
}: {
  reference: WorkflowRunAttemptReference;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  label?: string | undefined;
  children?: ReactNode | undefined;
}) {
  const referenceLabel = workflowRunReferenceLabel(reference);
  const content = label ?? referenceLabel;
  if (!workspaceSlug || !projectSlug) return content;

  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{workspaceSlug, projectSlug, workflowRunId: reference.workflowRunId}}
      search={
        ((previous: Record<string, unknown>) => ({
          ...withoutWorkflowRunSelectionSearch(previous),
          runAttempt: reference.attempt,
        })) as never
      }
      aria-label={label ? `${label}: ${referenceLabel}` : undefined}
      className="inline-flex items-center gap-tight rounded-4 text-foreground-highlight-interactive outline-none hover:underline focus-visible:shadow-button-neutral-focus"
    >
      {content}
      {children}
    </Link>
  );
}

function workflowRunReferenceLabel(reference: WorkflowRunAttemptReference): string {
  return `${reference.workflowName} run${
    reference.number === null ? '' : ` #${reference.number}`
  }, attempt ${reference.attempt}`;
}

function visibleConcurrency(
  status: WorkflowRunStatus,
  concurrency: WorkflowRunConcurrency | null,
  state: Extract<WorkflowRunConcurrency['state'], 'waiting' | 'superseded'>,
): WorkflowRunConcurrency | null {
  const expectedStatus = state === 'waiting' ? 'waiting' : 'cancelled';
  return status === expectedStatus && concurrency?.state === state ? concurrency : null;
}
