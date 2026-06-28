import {
  Button,
  Code,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  RelativeTime,
  Text,
} from '@shipfox/react-ui';
import {useState} from 'react';
import type {WorkflowRun, WorkflowRunAttempt} from '#core/workflow-run.js';
import {useWorkflowRunAttemptsQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowStatusIcon} from '../workflow-status/workflow-status-icon.js';

export interface WorkflowRunAttemptSwitcherProps {
  run: WorkflowRun;
  latestAttempt: number;
  onSelectAttempt: (runId: string) => void;
}

export function WorkflowRunAttemptSwitcher({
  run,
  latestAttempt,
  onSelectAttempt,
}: WorkflowRunAttemptSwitcherProps) {
  const [open, setOpen] = useState(false);
  const attemptsQuery = useWorkflowRunAttemptsQuery({
    runId: run.id,
    rootRunId: run.rootRunId,
    enabled: open,
  });

  if (latestAttempt <= 1) return null;

  const attempts = attemptsQuery.data ?? [];
  const maxAttempt =
    attempts.length > 0 ? Math.max(...attempts.map((attempt) => attempt.attempt)) : latestAttempt;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="transparentMuted"
          size="2xs"
          iconRight="arrowDownSLine"
          aria-label={`Switch attempt, currently ${run.attempt} of ${maxAttempt}`}
          className="h-20 px-4 text-foreground-neutral-muted hover:text-foreground-neutral-base"
        >
          <Code as="span" variant="label" className="text-inherit">
            Attempt {run.attempt} of {maxAttempt}
          </Code>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="lg">
        {attemptsQuery.isPending && attempts.length === 0 ? <LoadingRow /> : null}
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
                  current={attempt.id === run.id}
                  onSelectAttempt={onSelectAttempt}
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
  onSelectAttempt,
}: {
  attempt: WorkflowRunAttempt;
  current: boolean;
  onSelectAttempt: (runId: string) => void;
}) {
  return (
    <DropdownMenuItem
      aria-current={current ? 'true' : undefined}
      className={cn(current && 'bg-background-highlight-base text-foreground-neutral-base')}
      onSelect={() => onSelectAttempt(attempt.id)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-8">
        <WorkflowStatusIcon status={attempt.status} size={14} tooltip={false} />
        <Code as="span" variant="label" className="min-w-0 flex-1 truncate text-inherit">
          Attempt {attempt.attempt}
        </Code>
        <RelativeTime
          value={attempt.createdAt}
          className="shrink-0 whitespace-nowrap font-code text-xs leading-20 text-foreground-neutral-muted"
        />
      </span>
    </DropdownMenuItem>
  );
}
