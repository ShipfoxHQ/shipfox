import {Code, humanDuration, useTimeTick} from '@shipfox/react-ui';
import type {WorkflowJobDuration} from '#core/workflow-run.js';

export function JobDurationLabel({duration}: {duration: WorkflowJobDuration}) {
  switch (duration.kind) {
    case 'none':
      return null;
    case 'finished':
      return <DurationText>{humanDuration(duration.fromIso, duration.toIso)}</DurationText>;
    case 'queued':
    case 'running':
      return <LiveDurationText fromIso={duration.fromIso} />;
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

function LiveDurationText({fromIso}: {fromIso: string}) {
  useTimeTick();
  return <DurationText>{humanDuration(fromIso)}</DurationText>;
}

function DurationText({children}: {children: string}) {
  // The status icon names the state; the node aria-label carries the verb.
  return (
    <Code as="span" variant="label" className="shrink-0 tabular-nums text-foreground-neutral-muted">
      {children}
    </Code>
  );
}
