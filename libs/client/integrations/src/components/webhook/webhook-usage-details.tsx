import {WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button, ShipfoxLoader, Text} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useWebhookConnectionsQuery} from '#hooks/api/webhook-connections.js';
import {CopyableValue} from './copyable-value.js';

interface WebhookUsageDetailsProps {
  workspaceId: string;
  connectionId: string;
}

export function WebhookUsageDetails({workspaceId, connectionId}: WebhookUsageDetailsProps) {
  const connectionsQuery = useWebhookConnectionsQuery(workspaceId);
  const connection = connectionsQuery.data?.connections.find(
    (candidate) => candidate.id === connectionId,
  );

  if (connectionsQuery.isPending) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <ShipfoxLoader size={32} animation="circular" color="orange" background="light" />
      </div>
    );
  }

  if (connectionsQuery.isError && connectionsQuery.data === undefined) {
    return <QueryLoadError query={connectionsQuery} subject="webhook details" />;
  }

  if (!connection) return null;

  return (
    <div className="flex w-full flex-col gap-16">
      <div className="flex w-full min-w-0 flex-col gap-8">
        <Text size="sm" bold>
          Inbound URL
        </Text>
        <CopyableValue
          label="inbound URL"
          value={connection.inbound_url}
          note="Anyone with this URL can trigger your workflow."
        />
      </div>
      <Button asChild variant="transparentMuted" size="sm" iconRight="externalLinkLine">
        <Link
          to="/workspaces/$wid/settings/events"
          params={{wid: workspaceId}}
          search={{source: [connection.slug], event: [WEBHOOK_RECEIVED_EVENT]}}
        >
          View deliveries
        </Link>
      </Button>
    </div>
  );
}
