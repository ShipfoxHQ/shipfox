import {Link, useParams} from '@tanstack/react-router';
import {useReducedMotion} from 'framer-motion';

/**
 * Sticky tab strip beneath the nav. Always renders the 40px container so
 * navigation between workspace home (no `pid`) and project detail does not
 * cause a layout jump. Inside a project, renders the single "Overview" tab
 * with brand-orange underline; otherwise the strip is empty.
 */
export function ProjectTabs() {
  const params = useParams({strict: false}) as {wid?: string; pid?: string};
  const reduced = useReducedMotion();
  const inProject = Boolean(params.wid && params.pid);
  const inWorkspace = Boolean(params.wid && !params.pid);

  const tabClassName = `h-40 inline-flex items-center px-4 text-sm font-medium transition-colors ${
    reduced ? '' : 'transition-[border-color]'
  }`;
  const activeProps = {
    className: 'border-b-2 border-border-highlights-interactive text-foreground-neutral-base',
  };
  const inactiveProps = {
    className: 'border-b-2 border-transparent text-foreground-neutral-muted',
  };

  return (
    <div
      role="tablist"
      aria-label="Project sections"
      className="sticky top-56 z-20 h-40 px-16 flex items-end gap-12 bg-background-subtle-base border-b border-border-neutral-base"
    >
      {inWorkspace && params.wid ? (
        <Link
          to="/workspaces/$wid"
          params={{wid: params.wid}}
          role="tab"
          activeOptions={{exact: true}}
          activeProps={activeProps}
          inactiveProps={inactiveProps}
          className={tabClassName}
        >
          Projects
        </Link>
      ) : null}
      {inProject && params.wid && params.pid ? (
        <Link
          to="/workspaces/$wid/projects/$pid"
          params={{wid: params.wid, pid: params.pid}}
          role="tab"
          activeOptions={{exact: true}}
          activeProps={activeProps}
          inactiveProps={inactiveProps}
          className={tabClassName}
        >
          Overview
        </Link>
      ) : null}
    </div>
  );
}
