import {IconButton} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {Code} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import type {IssueAction, IssueCopy} from '#core/run-issue-copy.js';

const ACTION_CLASS =
  'mt-tight block font-medium text-foreground-neutral-base underline outline-none focus-visible:shadow-border-interactive-with-active';

export interface RunIssueCalloutProps {
  copy: IssueCopy;
  /** Without a workspace slug, an action that links inside the app is left out. */
  workspaceSlug?: string | undefined;
  onDismiss: () => void;
  onRefresh: () => void;
}

/** A compact error for a refused run start: what is wrong, where, and at most one way to fix it. */
export function RunIssueCallout({copy, workspaceSlug, onDismiss, onRefresh}: RunIssueCalloutProps) {
  return (
    <Callout role="alert" type="error" className="px-row py-row">
      <CalloutContent>
        <CalloutTitle className="mb-0 text-xs leading-20">{copy.title}</CalloutTitle>
        {copy.message.length > 0 ? (
          <CalloutDescription>
            {copy.message.map((segment, index) => {
              const key = `${segment.kind}:${index}`;
              if (segment.kind === 'code') {
                return (
                  <Code key={key} as="span" variant="label">
                    {segment.value}
                  </Code>
                );
              }
              return <span key={key}>{segment.value}</span>;
            })}
          </CalloutDescription>
        ) : null}
        {copy.action ? (
          <IssueActionControl
            action={copy.action}
            workspaceSlug={workspaceSlug}
            onRefresh={onRefresh}
          />
        ) : null}
      </CalloutContent>
      <IconButton
        icon="close"
        size="xs"
        variant="transparent"
        aria-label="Dismiss error"
        onClick={onDismiss}
      />
    </Callout>
  );
}

function IssueActionControl({
  action,
  workspaceSlug,
  onRefresh,
}: {
  action: IssueAction;
  workspaceSlug: string | undefined;
  onRefresh: () => void;
}) {
  if (action.kind === 'refresh') {
    return (
      <button type="button" className={ACTION_CLASS} onClick={onRefresh}>
        {action.label}
      </button>
    );
  }
  if (action.external) {
    return (
      <a href={action.to} target="_blank" rel="noreferrer" className={ACTION_CLASS}>
        {action.label}
      </a>
    );
  }
  if (workspaceSlug === undefined) return null;
  return (
    <Link
      to={action.to as never}
      params={{workspaceSlug} as never}
      search={action.search as never}
      className={ACTION_CLASS}
    >
      {action.label}
    </Link>
  );
}
