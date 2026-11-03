import {RequiredActionLink, Shippy} from '@shipfox/client-shell/runtime';
import {Button} from '@shipfox/react-ui/button';
import {
  Callout,
  CalloutActions,
  CalloutContent,
  CalloutDescription,
  CalloutTitle,
} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Link} from '@tanstack/react-router';
import type {TurnNotice} from '#core/conversation.js';
import type {TurnFailure, TurnFailureAction} from '#core/turn-state.js';
import type {UnavailableModel} from '#hooks/api/model-availability.js';

function ModelSettingsLink({workspaceSlug}: {workspaceSlug: string}) {
  return (
    <Button asChild size="2xs" variant="secondary" iconRight="chevronRight">
      <Link to="/w/$workspaceSlug/settings/agents" params={{workspaceSlug}}>
        Open model settings
      </Link>
    </Button>
  );
}

/** Every workspace member is an admin today, so the admin copy is the only one. */
export function NoModelState({workspaceSlug}: {workspaceSlug: string}) {
  return (
    <EmptyState
      illustration={<Shippy pose="lost" className="h-96" />}
      title="Connect a model to chat with Shippy."
      description="Shippy replies with the workspace's default model."
      action={<ModelSettingsLink workspaceSlug={workspaceSlug} />}
    />
  );
}

function FailureAction({
  action,
  busy,
  workspaceSlug,
  onRetry,
  onNewConversation,
}: {
  action: TurnFailureAction;
  busy: boolean;
  workspaceSlug: string;
  onRetry: () => void;
  onNewConversation: () => void;
}) {
  if (action === 'model-settings') return <ModelSettingsLink workspaceSlug={workspaceSlug} />;
  if (action === 'new-conversation') {
    return (
      <Button size="2xs" variant="secondary" onClick={onNewConversation}>
        New conversation
      </Button>
    );
  }
  return (
    <Button size="2xs" variant="secondary" isLoading={busy} onClick={onRetry}>
      {action === 'continue' ? 'Continue' : 'Retry'}
    </Button>
  );
}

export interface TurnFailureNoticeProps {
  failure: TurnFailure;
  /** The turn's model, when the catalog knows it. */
  model: UnavailableModel | undefined;
  workspaceSlug: string;
  busy: boolean;
  onRetry: () => void;
  onNewConversation: () => void;
}

/** A failed turn stores nothing, so this takes the place of its reply. */
export function TurnFailureNotice({
  failure,
  model,
  workspaceSlug,
  busy,
  onRetry,
  onNewConversation,
}: TurnFailureNoticeProps) {
  const lockedTitle = model ? `${model.label} isn't available.` : failure.title;
  const title = failure.kind === 'model-unavailable' ? lockedTitle : failure.title;
  const description =
    failure.kind === 'model-unavailable' ? (model?.message ?? undefined) : failure.description;
  const lockAction = failure.kind === 'model-unavailable' ? model?.action : undefined;

  return (
    <Callout type={failure.kind === 'too-long' ? 'warning' : 'error'}>
      <CalloutContent className="flex flex-col gap-inline">
        <div>
          <CalloutTitle className="mb-0">{title}</CalloutTitle>
          {description ? <CalloutDescription>{description}</CalloutDescription> : null}
        </div>
        <CalloutActions className="flex-wrap">
          {lockAction ? <RequiredActionLink action={lockAction} appearance="button" /> : null}
          {failure.actions.map((action) =>
            action === 'model-settings' && lockAction ? null : (
              <FailureAction
                key={action}
                action={action}
                busy={busy}
                workspaceSlug={workspaceSlug}
                onRetry={onRetry}
                onNewConversation={onNewConversation}
              />
            ),
          )}
        </CalloutActions>
      </CalloutContent>
    </Callout>
  );
}

export interface TurnNoticeCalloutProps {
  notice: TurnNotice;
  /** Offered on the latest notice only, and only when the denial can clear. */
  onSendAgain: (() => void) | undefined;
  /** Offered when the conversation is too long to continue. */
  onNewConversation?: (() => void) | undefined;
  busy: boolean;
}

/** Why a message got no reply. Its required action resolves it, and `Send again` retries. */
export function TurnNoticeCallout({
  notice,
  onSendAgain,
  onNewConversation,
  busy,
}: TurnNoticeCalloutProps) {
  return (
    <Callout type="warning">
      <CalloutContent className="flex flex-col gap-inline">
        <CalloutTitle className="mb-0">
          {/* The required action names its own fix, so the title doesn't repeat it. */}
          {notice.message ?? "Shippy can't reply until this is resolved."}
        </CalloutTitle>
        {notice.requiredAction || onSendAgain || onNewConversation ? (
          <CalloutActions className="flex-wrap">
            {notice.requiredAction ? (
              <RequiredActionLink action={notice.requiredAction} appearance="button" />
            ) : null}
            {onSendAgain ? (
              <Button size="2xs" variant="secondary" isLoading={busy} onClick={onSendAgain}>
                Send again
              </Button>
            ) : null}
            {onNewConversation ? (
              <Button size="2xs" variant="secondary" onClick={onNewConversation}>
                New conversation
              </Button>
            ) : null}
          </CalloutActions>
        ) : null}
      </CalloutContent>
    </Callout>
  );
}
