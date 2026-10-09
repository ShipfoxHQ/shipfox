import {Button, IconButton} from '@shipfox/react-ui/button';
import {PanelActions, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import type {SetupChecklist} from '#core/setup-checklist.js';

export interface ChecklistExpansionControl {
  expanded: boolean;
  /** The panel body the toggle controls. */
  bodyId: string;
  onToggle: () => void;
}

export function ChecklistDismissAction({onDismiss}: {onDismiss: () => void}) {
  return (
    <div className="flex justify-end border-t border-border-neutral-base px-row py-row">
      <Button type="button" size="sm" variant="transparentMuted" onClick={onDismiss}>
        Hide setup guide
      </Button>
    </div>
  );
}

export function ChecklistHeader({
  count,
  expansion,
  onDismiss,
}: {
  count?: string | undefined;
  expansion?: ChecklistExpansionControl | undefined;
  onDismiss: () => void;
}) {
  return (
    <PanelHeader className="flex-wrap">
      <div className="flex min-w-0 items-center gap-group">
        <PanelTitle>Get started</PanelTitle>
        {count ? (
          <Text as="span" size="sm" className="shrink-0 text-foreground-neutral-muted">
            {count}
          </Text>
        ) : null}
      </div>
      <PanelActions>
        {expansion ? (
          <Button
            type="button"
            size="sm"
            variant="transparentMuted"
            aria-expanded={expansion.expanded}
            aria-controls={expansion.bodyId}
            iconRight={expansion.expanded ? 'arrowUpSLine' : 'arrowDownSLine'}
            onClick={expansion.onToggle}
          >
            {expansion.expanded ? 'Show less' : 'Show all steps'}
          </Button>
        ) : null}
        <IconButton
          type="button"
          variant="transparent"
          size="sm"
          muted
          icon="close"
          aria-label="Hide setup guide"
          onClick={onDismiss}
        />
      </PanelActions>
    </PanelHeader>
  );
}

export function checklistCountLabel(checklist: SetupChecklist) {
  return `${checklist.trackedCount - checklist.openCount} of ${checklist.trackedCount} done`;
}
