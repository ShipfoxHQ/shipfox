import {useLocation} from '@tanstack/react-router';
import {lazy, Suspense, useState} from 'react';
import type {ProjectDockContribution} from '#contract.js';
import {useProjectDock} from '#runtime/project-dock.js';
import {ReportErrorBoundary} from '#runtime/report-error-boundary.js';

/** Every attempt reports its failure, so a dock that keeps failing stops retrying. */
const MAX_DOCK_ATTEMPTS = 3;

/**
 * Renders the dock and retries it on navigation. A retry needs a new `lazy`
 * component, because React keeps the rejection of the previous one.
 */
export function ProjectDockHost({
  dock,
  onFailed,
  onRecovered,
}: {
  dock: ProjectDockContribution;
  onFailed: () => void;
  onRecovered: () => void;
}) {
  const location = useLocation();
  const {setOpen} = useProjectDock();
  const [Dock, setDock] = useState(() => lazy(dock.load));
  const [failures, setFailures] = useState(0);

  if (failures >= MAX_DOCK_ATTEMPTS) return null;

  return (
    <ReportErrorBoundary
      label="Failed to render the project dock."
      retryKey={location.href}
      onError={() => {
        setFailures((count) => count + 1);
        // The stored flag must not outlive the failure, or the launcher would stay hidden.
        setOpen(false);
        onFailed();
      }}
      onRecovered={() => {
        setDock(lazy(dock.load));
        onRecovered();
      }}
    >
      <Suspense fallback={null}>
        <Dock />
      </Suspense>
    </ReportErrorBoundary>
  );
}
