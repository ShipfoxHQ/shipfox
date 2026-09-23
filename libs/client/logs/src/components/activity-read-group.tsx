'use client';

import {Icon} from '@shipfox/react-ui/icon';
import {LogRow} from '@shipfox/react-ui/log';
import {useEffect, useId, useState} from 'react';
import {
  type ActionPresentationLookup,
  type ActivityReadGroupNode,
  resolveActionPresentation,
} from '#core/activity.js';
import {ActionIdentityIcon, ActivityActionRow, actionDisplayLabel} from './activity-action-row.js';

export function ActivityReadGroup({
  node,
  indent,
  terminated,
  forceOpen,
  focusedActionSeq,
  actionPresentation,
}: {
  node: ActivityReadGroupNode;
  indent: number;
  terminated: boolean;
  forceOpen: boolean;
  focusedActionSeq: number | null;
  actionPresentation?: ActionPresentationLookup | undefined;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const grouped = node.totalCount > 1;
  const containsFocus = node.children.some((child) => child.seq === focusedActionSeq);
  const visible = !grouped || forceOpen || open || containsFocus;
  useEffect(() => {
    if (grouped && containsFocus) setOpen(true);
  }, [grouped, containsFocus]);
  const first = node.children[0];
  if (!first) return null;
  const presentation = resolveActionPresentation(first.action, actionPresentation);
  const count = node.children.length;
  const countLabel = `${count} ${count === 1 ? 'read' : 'reads'}`;
  const displayedCount =
    node.totalCount === count ? countLabel : `${count} of ${node.totalCount} reads`;

  return (
    <div data-activity-anchor={node.seq}>
      {grouped ? (
        <LogRow lineNumber={null} timestamp={new Date(first.action.timestamp)} indent={indent}>
          <button
            type="button"
            aria-label={`${actionDisplayLabel(presentation)}, ${displayedCount}`}
            aria-expanded={visible}
            aria-controls={contentId}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex min-w-0 w-full items-center gap-inline text-left focus-visible:shadow-focus-inset!"
          >
            <Icon
              name="chevronRight"
              className={`size-16 flex-none text-foreground-contrast-secondary motion-safe:transition-transform ${visible ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            <ActionIdentityIcon presentation={presentation} />
            <span className="truncate font-medium">{actionDisplayLabel(presentation)}</span>
            <span className="flex-none text-foreground-contrast-secondary">{displayedCount}</span>
          </button>
        </LogRow>
      ) : null}
      <div id={contentId} hidden={!visible}>
        {node.children.map((child) => (
          <div key={child.seq} data-activity-anchor={child.seq} data-activity-action={child.seq}>
            <ActivityActionRow
              action={child.action}
              indent={grouped ? indent + 1 : indent}
              terminated={terminated}
              forceOpen={forceOpen}
              presentation={resolveActionPresentation(child.action, actionPresentation)}
              hideIcon={grouped}
              onOpenChange={grouped ? undefined : setOpen}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
