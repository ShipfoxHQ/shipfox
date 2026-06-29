import {Code, humanDuration} from '@shipfox/react-ui';
import type {JobDurationDisplay} from './job-duration.js';
import {useDurationTick} from './job-duration-ticker.js';

/**
 * Renders a job node's duration as a bare, muted, monospace number. There is no
 * verb: the node's status icon already names the state, so `6m` beside a queued
 * job and `2m 14s` beside a succeeded one read unambiguously. The verb-bearing
 * phrasing lives in the node's `aria-label` for screen readers.
 */
export function JobDurationLabel({duration}: {duration: JobDurationDisplay}) {
  switch (duration.kind) {
    case 'none':
      return null;
    case 'finished':
      return <DurationText>{humanDuration(duration.fromIso, duration.toIso)}</DurationText>;
    case 'queued':
    case 'running':
      return <LiveDurationText fromIso={duration.fromIso} />;
  }
}

/** Subscribes to the shared 1s ticker so the elapsed value advances each second. */
function LiveDurationText({fromIso}: {fromIso: string}) {
  useDurationTick();
  return <DurationText>{humanDuration(fromIso)}</DurationText>;
}

function DurationText({children}: {children: string}) {
  return (
    <Code as="span" variant="label" className="shrink-0 tabular-nums text-foreground-neutral-muted">
      {children}
    </Code>
  );
}
