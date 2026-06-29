import {useAgentProviderConfigsQuery} from '@shipfox/client-agent';
import {
  Alert,
  AlertActions,
  AlertClose,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Button,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

const REMINDER_SESSION_KEY_PREFIX = 'shipfox.agentProviderReminder.dismissed.';

export function AgentProviderReminderBanner({workspaceId}: {workspaceId: string}) {
  const configsQuery = useAgentProviderConfigsQuery(workspaceId);
  const [dismissed, setDismissed] = useState(() => isReminderDismissed(workspaceId));
  const configs = configsQuery.data?.configs;
  const unconfigured =
    Array.isArray(configs) &&
    configs.length === 0 &&
    configsQuery.data?.default_provider_id === null;

  if (!unconfigured || dismissed) return null;

  return (
    <Alert
      variant="info"
      animated={false}
      onOpenChange={(open) => {
        if (!open) {
          dismissReminder(workspaceId);
          setDismissed(true);
        }
      }}
    >
      <AlertContent className="pr-28">
        <AlertTitle>Finish setting up an agent provider</AlertTitle>
        <AlertDescription>
          Add workspace credentials, or keep using the instance default.
        </AlertDescription>
        <AlertActions>
          <Button asChild size="sm" variant="secondary">
            <Link to="/workspaces/$wid/settings/agent-providers" params={{wid: workspaceId}}>
              Agent Providers
            </Link>
          </Button>
        </AlertActions>
      </AlertContent>
      <AlertClose />
    </Alert>
  );
}

function isReminderDismissed(workspaceId: string): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return window.sessionStorage.getItem(sessionKey(workspaceId)) === 'true';
  } catch {
    return false;
  }
}

function dismissReminder(workspaceId: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(sessionKey(workspaceId), 'true');
  } catch {
    // Session persistence is best-effort; showing the banner again is benign.
  }
}

function sessionKey(workspaceId: string): string {
  return `${REMINDER_SESSION_KEY_PREFIX}${workspaceId}`;
}
