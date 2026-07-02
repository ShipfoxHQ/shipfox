import {Button} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';
import type {WorkflowRunAttempt, WorkflowRunDetail} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {useWorkflowRunAttemptsQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowStatusIcon} from '../workflow-status/workflow-status-icon.js';

export interface WorkflowRunAttemptSwitcherProps {
  workspaceId: string;
  projectId: string;
  run: WorkflowRunDetail;
  latestAttempt: number;
}

export function WorkflowRunAttemptSwitcher({
  workspaceId,
  projectId,
  run,
  latestAttempt,
}: WorkflowRunAttemptSwitcherProps) {
  const [open, setOpen] = useState(false);
  const attemptsQuery = useWorkflowRunAttemptsQuery({
    workflowRunId: run.id,
    enabled: open,
  });

  if (latestAttempt <= 1) return null;

  const attempts = attemptsQuery.data ?? [];
  const latestLoadedAttempt = Math.max(0, ...attempts.map((attempt) => attempt.attempt));
  const maxAttempt = Math.max(latestAttempt, run.runAttempt.attempt, latestLoadedAttempt);
  const isLoadingMissingAttempt =
    attempts.length > 0 && attemptsQuery.isFetching && latestLoadedAttempt < maxAttempt;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="transparentMuted"
          size="2xs"
          iconRight="arrowDownSLine"
          aria-label={`Switch attempt, currently ${run.runAttempt.attempt} of ${maxAttempt}`}
          className="h-20 px-4 text-foreground-neutral-muted hover:text-foreground-neutral-base"
        >
          <Text as="span" size="xs" className="text-inherit">
            Attempt {run.runAttempt.attempt} of {maxAttempt}
          </Text>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="lg">
        {attemptsQuery.isPending && attempts.length === 0 ? <LoadingRow /> : null}
        {isLoadingMissingAttempt ? <LoadingRow /> : null}
        {attemptsQuery.isError && attempts.length === 0 ? (
          <ErrorRow onRetry={() => void attemptsQuery.refetch()} />
        ) : null}
        {attempts.length > 0
          ? [...attempts]
              .sort((left, right) => right.attempt - left.attempt)
              .map((attempt) => (
                <AttemptItem
                  key={attempt.id}
                  attempt={attempt}
                  current={attempt.id === run.runAttempt.id}
                  workflowRunId={run.id}
                  workspaceId={workspaceId}
                  projectId={projectId}
                />
              ))
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LoadingRow() {
  return (
    <DropdownMenuItem disabled>
      <Text as="span" size="sm" className="text-foreground-neutral-muted">
        Loading attempts...
      </Text>
    </DropdownMenuItem>
  );
}

function ErrorRow({onRetry}: {onRetry: () => void}) {
  return (
    <DropdownMenuItem closeOnSelect={false} onSelect={onRetry}>
      <Text as="span" size="sm" className="text-foreground-highlight-error">
        Could not load attempts. Retry
      </Text>
    </DropdownMenuItem>
  );
}

function AttemptItem({
  attempt,
  current,
  workflowRunId,
  workspaceId,
  projectId,
}: {
  attempt: WorkflowRunAttempt;
  current: boolean;
  workflowRunId: string;
  workspaceId: string;
  projectId: string;
}) {
  return (
    <DropdownMenuItem asChild className={cn(current && 'text-foreground-neutral-base')}>
      <Link
        to="/workspaces/$wid/projects/$pid/runs/$workflowRunId"
        params={{wid: workspaceId, pid: projectId, workflowRunId}}
        search={
          ((previous: Record<string, unknown>) => {
            if (current) return previous;
            return {
              ...withoutWorkflowRunSelectionSearch(previous),
              runAttempt: attempt.attempt,
            };
          }) as never
        }
        aria-current={current ? 'page' : undefined}
      >
        <WorkflowStatusIcon status={attempt.status} size={14} tooltip={false} />
        <Code as="span" variant="label" className="min-w-0 flex-1 truncate text-inherit">
          Attempt {attempt.attempt}
        </Code>
        <RelativeTime
          value={attempt.createdAt}
          className="shrink-0 whitespace-nowrap font-code text-xs leading-20 text-foreground-neutral-muted"
        />
      </Link>
    </DropdownMenuItem>
  );
}
