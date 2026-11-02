import {cn} from '@shipfox/react-ui/utils';
import {useEffect, useRef} from 'react';
import {type ShippyPlacement, useProjectDock} from '#runtime/project-dock.js';
import {Shippy} from './shippy.js';

/** Shippy moves into the panel header while the panel is open, so it shows only once. */
function useLauncher() {
  const {open, setOpen} = useProjectDock();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (wasOpenRef.current && !open) buttonRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return {open, buttonRef, openDock: () => setOpen(true)};
}

export function ShippyLauncher({placement}: {placement: ShippyPlacement}) {
  const {open, buttonRef, openDock} = useLauncher();
  if (open) return null;
  const floating = placement === 'floating';

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Open Shippy, your project agent"
      aria-expanded={false}
      className={cn(
        'rounded-6 focus-visible:outline-none focus-visible:shadow-button-neutral-focus',
        floating ? 'absolute right-(--pad-frame-x) bottom-8 z-10' : 'shrink-0',
      )}
      onClick={openDock}
    >
      <Shippy
        pose={floating ? 'body' : 'face'}
        className={cn('block', floating ? 'h-64' : 'h-32')}
      />
    </button>
  );
}
