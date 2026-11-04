import {cn} from '@shipfox/react-ui/utils';
import {useEffect, useRef} from 'react';
import {type ShippyPlacement, useProjectDock} from '#runtime/project-dock.js';
import {useCurrentShippyStatus} from '#runtime/shippy-status.js';
import {Shippy} from './shippy.js';
import {ShippyGreeting, useShippyGreeting} from './shippy-greeting.js';
import {ShippySprite} from './shippy-sprite.js';

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
  const {state} = useCurrentShippyStatus();
  const greeting = useShippyGreeting();
  if (open) return null;
  const floating = placement === 'floating';
  // The discreet face never moves and never greets.
  const greet = floating && greeting.pending;

  const button = (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Open Shippy, your project agent"
      aria-expanded={false}
      className={cn(
        'rounded-6 focus-visible:outline-none focus-visible:shadow-button-neutral-focus',
        !floating && 'shrink-0',
      )}
      onClick={openDock}
    >
      {floating ? (
        <ShippySprite state={greet ? 'greeting' : state} />
      ) : (
        <Shippy pose="face" className="block h-32" />
      )}
    </button>
  );
  if (!floating) return button;

  return (
    <div className="absolute right-(--pad-frame-x) bottom-8 z-10 flex items-end gap-inline">
      {greet ? (
        <ShippyGreeting
          onSayHello={() => {
            greeting.dismiss();
            openDock();
          }}
          onDismiss={greeting.dismiss}
        />
      ) : undefined}
      {button}
    </div>
  );
}
