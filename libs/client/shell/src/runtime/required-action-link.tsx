import type {RequiredAction} from '@shipfox/policy-notice';
import {Button} from '@shipfox/react-ui/button';
import type {ComponentProps} from 'react';
import {type RequiredActionAppearance, useOptionalChrome} from './chrome-context.js';
import {ReportErrorBoundary} from './report-error-boundary.js';
import {resolveRequiredActionTarget} from './required-action-url.js';

export type RequiredActionTriggerProps = Omit<
  ComponentProps<typeof Button>,
  'variant' | 'size' | 'iconLeft' | 'iconRight'
> & {appearance: RequiredActionAppearance};

/** The styled element of a required action, for slot implementations that render their own control. */
export function RequiredActionTrigger({appearance, ...props}: RequiredActionTriggerProps) {
  return (
    <Button
      data-appearance={appearance}
      size="2xs"
      variant="secondary"
      iconRight="chevronRight"
      {...props}
    />
  );
}

export interface RequiredActionDefaultLinkProps {
  action: RequiredAction;
  appearance: RequiredActionAppearance;
  /** Called when the user follows the link. It does not prevent navigation. */
  onSelect?: (() => void) | undefined;
}

/** Renders `action.url` under the URL rule and ignores `action.intent`. */
export function RequiredActionDefaultLink({
  action,
  appearance,
  onSelect,
}: RequiredActionDefaultLinkProps) {
  const target = resolveRequiredActionTarget(action.url, window.location.origin);
  if (target === undefined) return <span>{action.message}</span>;

  const external = target.kind === 'new-tab';
  return (
    <RequiredActionTrigger appearance={appearance} asChild>
      <a
        href={target.href}
        {...(external ? {target: '_blank', rel: 'noreferrer noopener'} : {})}
        {...(onSelect ? {onClick: onSelect} : {})}
      >
        {action.message}
      </a>
    </RequiredActionTrigger>
  );
}

export interface RequiredActionLinkProps {
  action: RequiredAction;
  appearance: RequiredActionAppearance;
}

/**
 * Renders a required action. An action with an `intent` goes to the
 * `RequiredActionIntent` chrome slot when the composing application provides
 * one. Every other action, and a slot that fails, renders the default link.
 */
export function RequiredActionLink({action, appearance}: RequiredActionLinkProps) {
  const IntentSlot = useOptionalChrome()?.RequiredActionIntent;
  const fallback = <RequiredActionDefaultLink action={action} appearance={appearance} />;
  const {intent} = action;
  if (intent === undefined || IntentSlot === undefined) return fallback;

  return (
    <ReportErrorBoundary
      label="Failed to render required action intent."
      retryKey={`${intent}\n${action.url}`}
      fallback={fallback}
    >
      <IntentSlot action={{...action, intent}} appearance={appearance} fallback={fallback} />
    </ReportErrorBoundary>
  );
}
