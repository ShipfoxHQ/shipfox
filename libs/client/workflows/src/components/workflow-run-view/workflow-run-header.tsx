import type {RunResponseDto} from '@shipfox/api-workflows-dto';
import {Badge, RelativeTime, Text} from '@shipfox/react-ui';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';

export function WorkflowRunHeader({run}: {run: RunResponseDto}) {
  const status = getWorkflowStatusVisual(run.status);

  return (
    <header className="flex w-full items-center gap-12 border-b border-border-neutral-base bg-background-subtle-base px-16 py-12">
      <Text size="lg" bold className="min-w-0 truncate">
        {run.name}
      </Text>
      <Badge variant={status.badge} className="shrink-0">
        {status.label}
      </Badge>

      <span aria-hidden="true" className="h-20 w-px shrink-0 bg-border-neutral-base" />

      <Text size="sm" className="shrink-0 text-foreground-neutral-subtle">
        {run.trigger_source}
      </Text>
      <RelativeTime
        value={run.created_at}
        className="shrink-0 text-sm text-foreground-neutral-muted"
      />
    </header>
  );
}
