import {Fragment} from 'react';

export interface WorkflowSourceCaller {
  stepId: string;
  /** Where the calling `uses:` step sits, such as `workflow.yaml:12-15`. */
  label: string;
}

export interface WorkflowSourceBreadcrumbProps {
  /** The steps that call the shown file, outermost first. */
  callers: readonly WorkflowSourceCaller[];
  /** The file shown below the breadcrumb. */
  current: string;
  onSelectCaller?: ((stepId: string) => void) | undefined;
}

export function WorkflowSourceBreadcrumb({
  callers,
  current,
  onSelectCaller,
}: WorkflowSourceBreadcrumbProps) {
  return (
    <nav aria-label="Source path" className="flex min-w-0 grow items-center">
      <ol className="flex min-w-0 items-center gap-tight overflow-hidden whitespace-nowrap font-code text-xs leading-20 text-foreground-contrast-secondary">
        {callers.map((caller) => (
          <Fragment key={caller.stepId}>
            <li className="min-w-0 shrink truncate">
              {onSelectCaller ? (
                <button
                  type="button"
                  onClick={() => onSelectCaller(caller.stepId)}
                  className="max-w-full truncate rounded-4 underline-offset-2 outline-none hover:text-foreground-contrast-primary hover:underline focus-visible:shadow-border-interactive-with-active"
                >
                  {caller.label}
                </button>
              ) : (
                caller.label
              )}
            </li>
            <li aria-hidden="true" className="shrink-0">
              ›
            </li>
          </Fragment>
        ))}
        <li aria-current="location" className="min-w-0 truncate text-foreground-contrast-primary">
          {current}
        </li>
      </ol>
    </nav>
  );
}
