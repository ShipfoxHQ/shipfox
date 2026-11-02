import {useMediaQuery} from '@shipfox/react-ui/hooks/useMediaQuery';
import {Sheet, SheetContent, SheetTitle} from '@shipfox/react-ui/sheet';
import {type PropsWithChildren, useEffect, useRef} from 'react';
import {PROJECT_DOCK_QUERY, useProjectDock} from '#runtime/project-dock.js';

export interface ProjectDockPanelProps extends PropsWithChildren {
  /** Accessible name of the docked region, and the title of the sheet. */
  label: string;
}

/**
 * The surface a `projectDock` contribution draws its panel on. It pushes the
 * page at wide viewports, with no focus trap, and is a modal sheet below them.
 * It renders nothing while the dock is closed, so a contribution that must
 * outlive a closed panel keeps that state above this component.
 *
 * The shell draws no close control here or in the sheet. The contribution must
 * render one that calls `useProjectDock().setOpen(false)`, because a touch
 * screen has no other way out of the sheet.
 */
export function ProjectDockPanel({label, children}: ProjectDockPanelProps) {
  const {open, setOpen} = useProjectDock();
  const docked = useMediaQuery(PROJECT_DOCK_QUERY);

  if (docked) return open ? <DockedPanel label={label}>{children}</DockedPanel> : null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        data-presentation="sheet"
        className="w-full border-l-0 outline-none sm:max-w-none"
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}

function DockedPanel({label, children}: ProjectDockPanelProps) {
  const asideRef = useRef<HTMLElement | null>(null);

  // The launcher unmounts as the panel opens, which would drop focus on the body.
  useEffect(() => {
    if (document.activeElement === document.body) asideRef.current?.focus();
  }, []);

  return (
    <aside
      ref={asideRef}
      aria-label={label}
      tabIndex={-1}
      data-presentation="docked"
      className="flex min-h-0 w-[400px] shrink-0 flex-col border-l border-border-neutral-base bg-background-neutral-base outline-none"
    >
      {children}
    </aside>
  );
}
