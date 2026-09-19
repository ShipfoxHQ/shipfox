import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutTitle} from '@shipfox/react-ui/callout';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Text} from '@shipfox/react-ui/typography';
import type {
  WorkflowRunAttemptReference,
  WorkflowRunConcurrencyImpact,
  WorkflowRunConcurrencyImpactEffect,
} from '#core/workflow-run.js';
import {useWorkflowRunAttemptReferenceQueries} from '#hooks/api/workflow-run-overview.js';
import {WorkflowRunReferenceLink} from './workflow-run-concurrency-presentation.js';

interface WorkflowRerunImpactDialogProps {
  impacts: readonly WorkflowRunConcurrencyImpact[];
  impactChanged: boolean;
  errorMessage?: string | undefined;
  isPending: boolean;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  onDismiss: () => void;
  onConfirm: () => void;
}

export function WorkflowRerunImpactDialog({
  impacts,
  impactChanged,
  errorMessage,
  isPending,
  workspaceSlug,
  projectSlug,
  onDismiss,
  onConfirm,
}: WorkflowRerunImpactDialogProps) {
  const referenceQueries = useWorkflowRunAttemptReferenceQueries(impacts, impacts.length > 0);
  const referencesUnavailable = referenceQueries.some(
    (query) => query.isError || query.data === null,
  );
  const referencesReady =
    referenceQueries.length === impacts.length &&
    referenceQueries.every((query) => query.data !== undefined && query.data !== null);

  return (
    <Modal
      open={impacts.length > 0}
      onOpenChange={(open) => {
        if (!open && !isPending) onDismiss();
      }}
    >
      <ModalContent className="max-w-[560px]">
        <ModalHeader showClose={!isPending}>
          <ModalTitle>Confirm re-run impact</ModalTitle>
        </ModalHeader>
        <ModalBody className="gap-group">
          <ModalDescription>
            Starting this re-run will affect other attempts in its concurrency group. Review every
            effect before continuing.
          </ModalDescription>
          {impactChanged ? (
            <Callout role="status" aria-live="polite" type="warning">
              <CalloutContent>
                <CalloutTitle>Concurrency changed</CalloutTitle>
                <Text size="xs" className="text-foreground-neutral-muted">
                  The affected attempts changed while you were confirming. Review the current list
                  and confirm again.
                </Text>
              </CalloutContent>
            </Callout>
          ) : null}
          <ul
            aria-label="Affected workflow attempts"
            className="w-full divide-y divide-border-neutral-base border-y border-border-neutral-base"
          >
            {impacts.map((impact, index) => (
              <WorkflowRerunImpactItem
                key={`${impact.workflowRunAttemptId}:${impact.plannedEffect}`}
                impact={impact}
                reference={referenceQueries[index]?.data ?? undefined}
                referencePending={referenceQueries[index]?.isPending ?? false}
                referenceUnavailable={
                  referenceQueries[index]?.isError || referenceQueries[index]?.data === null
                }
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
              />
            ))}
          </ul>
          {referencesUnavailable ? (
            <Callout role="alert" type="error">
              <CalloutContent>
                <CalloutTitle>Run details unavailable</CalloutTitle>
                <Text size="xs" className="text-foreground-neutral-muted">
                  Cancel and try the re-run again before confirming its impact.
                </Text>
              </CalloutContent>
            </Callout>
          ) : null}
          {errorMessage ? (
            <Callout role="alert" type="error">
              <CalloutContent>
                <Text size="sm">{errorMessage}</Text>
              </CalloutContent>
            </Callout>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" disabled={isPending} onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!referencesReady}
            isLoading={isPending}
            onClick={onConfirm}
          >
            Confirm and re-run
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function WorkflowRerunImpactItem({
  impact,
  reference,
  referencePending,
  referenceUnavailable,
  workspaceSlug,
  projectSlug,
}: {
  impact: WorkflowRunConcurrencyImpact;
  reference: WorkflowRunAttemptReference | null | undefined;
  referencePending: boolean;
  referenceUnavailable: boolean;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  const presentation = impactPresentation(impact.plannedEffect);
  let referenceContent = 'Unavailable workflow run';
  if (referencePending) referenceContent = 'Loading run details…';
  else if (referenceUnavailable) referenceContent = 'Run details unavailable';

  return (
    <li className="flex min-w-0 flex-col gap-inline py-row">
      <div className="flex min-w-0 flex-wrap items-center gap-inline">
        <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
        <Text size="sm" className="min-w-0 break-words font-medium">
          {reference ? (
            <WorkflowRunReferenceLink
              reference={reference}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
            />
          ) : (
            referenceContent
          )}
        </Text>
      </div>
      <Text as="p" size="xs" className="text-foreground-neutral-muted">
        {presentation.description}
      </Text>
    </li>
  );
}

function impactPresentation(effect: WorkflowRunConcurrencyImpactEffect): {
  badgeVariant: 'warning' | 'error';
  label: string;
  description: string;
} {
  if (effect === 'supersede_waiter') {
    return {
      badgeVariant: 'warning',
      label: 'Supersede waiting run',
      description: 'The waiting attempt will be cancelled before it starts.',
    };
  }
  return {
    badgeVariant: 'error',
    label: 'Cancel active run',
    description:
      'The active attempt will be asked to stop. Its process may overlap briefly with the re-run.',
  };
}
