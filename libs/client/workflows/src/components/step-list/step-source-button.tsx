import {Button, cn} from '@shipfox/react-ui';
import {type RefObject, useRef} from 'react';

export interface WorkflowStepSourceButtonProps {
  sourcePanelId: string;
  expanded: boolean;
  onOpen: (triggerRef: RefObject<HTMLButtonElement | null>) => void;
}

/**
 * Icon-only row action that opens the workflow source panel focused on this
 * step. Render-only: the row decides whether it should appear (anchor row with a
 * source snapshot and a located step) and supplies the open handler. Revealed on
 * row hover/focus and while the panel is focused on this step, but always in the
 * tab order so it stays keyboard-reachable.
 */
export function WorkflowStepSourceButton({
  sourcePanelId,
  expanded,
  onOpen,
}: WorkflowStepSourceButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="transparentMuted"
      size="xs"
      iconLeft="codeSSlashLine"
      aria-label="View step source"
      aria-controls={sourcePanelId}
      aria-expanded={expanded}
      onClick={() => onOpen(buttonRef)}
      className={cn(
        'shrink-0 opacity-0 transition-opacity',
        'group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100',
        expanded && 'opacity-100',
      )}
    />
  );
}
