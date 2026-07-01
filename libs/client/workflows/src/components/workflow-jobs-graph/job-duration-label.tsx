import {Code, humanDuration, useTimeTick} from '@shipfox/react-ui';
import type {JobDisplayDuration, JobExecutionTime} from '#core/workflow-run.js';

export function JobDurationLabel({duration}: {duration: JobDisplayDuration | null}) {
  if (duration === null) return null;

  if (duration.state === 'live') {
    return <LiveDurationText fromIso={duration.fromIso} />;
  }

  return <DurationText>{timeText(duration)}</DurationText>;
}

function timeText(time: JobExecutionTime): string {
  switch (time.state) {
    case 'live':
      return humanDuration(time.fromIso);
    case 'fixed':
      return fixedDurationText(time.elapsed);
    default: {
      const exhaustive: never = time;
      return exhaustive;
    }
  }
}

function fixedDurationText({
  years = 0,
  months = 0,
  weeks = 0,
  days = 0,
  hours = 0,
  minutes = 0,
  seconds = 0,
}: Extract<JobExecutionTime, {state: 'fixed'}>['elapsed']): string {
  const totalDays = years * 365 + months * 30 + weeks * 7 + days;
  const totalHours = totalDays * 24 + hours;

  if (totalHours > 0) return `${totalHours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  return `${seconds}s`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
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
