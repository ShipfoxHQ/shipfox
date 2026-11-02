import {useLocation} from '@tanstack/react-router';
import {lazy, Suspense, useEffect, useState} from 'react';
import type {ProjectDockContribution} from '#contract.js';
import {useProjectDock} from '#runtime/project-dock.js';
import {useProjectDockFailures} from '#runtime/project-dock-failures.js';
import {ReportErrorBoundary} from '#runtime/report-error-boundary.js';

/**
 * Renders the dock and retries it on navigation. A retry needs a new `lazy`
 * component, because React keeps the rejection of the previous one.
 */
export function ProjectDockHost({dock, scope}: {dock: ProjectDockContribution; scope: string}) {
  const location = useLocation();
  const {setOpen} = useProjectDock();
  const {exhausted, recordFailure, clearFailing} = useProjectDockFailures(scope);
  const [Dock, setDock] = useState(() => lazy(dock.load));

  // Coming back to the project starts a new attempt from a new host.
  useEffect(() => clearFailing, [clearFailing]);

  if (exhausted) return null;

  return (
    <ReportErrorBoundary
      label="Failed to render the project dock."
      retryKey={location.href}
      onError={() => {
        recordFailure();
        // The stored flag must not outlive the failure, or the launcher would stay hidden.
        setOpen(false);
      }}
      onRecovered={() => {
        setDock(lazy(dock.load));
        clearFailing();
      }}
    >
      <Suspense fallback={null}>
        <Dock />
      </Suspense>
    </ReportErrorBoundary>
  );
}
