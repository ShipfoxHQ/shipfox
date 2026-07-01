import {WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Alert,
  Button,
  Code,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ShipfoxLoader,
  Switch,
  Text,
  toast,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';
import {useEffect, useState} from 'react';
import {ConnectionStatusBadge} from '#connection-status-badge.js';
import {
  useDeleteWebhookConnectionMutation,
  useUpdateWebhookConnectionMutation,
  useWebhookConnectionsQuery,
} from '#hooks/api/webhook-connections.js';
import {CopyableValue} from './copyable-value.js';

interface WebhookManageModalProps {
  workspaceId: string;
  connectionId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WebhookManageModal({
  workspaceId,
  connectionId,
  open,
  onOpenChange,
}: WebhookManageModalProps) {
  const connectionsQuery = useWebhookConnectionsQuery(open ? workspaceId : undefined);
  const updateWebhook = useUpdateWebhookConnectionMutation();
  const deleteWebhook = useDeleteWebhookConnectionMutation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const connection = connectionsQuery.data?.connections.find(
    (candidate) => candidate.id === connectionId,
  );

  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      return;
    }
    if (connectionsQuery.data && connectionId && !connection) {
      toast.error('Webhook connection not found.');
      onOpenChange(false);
    }
  }, [connection, connectionId, connectionsQuery.data, onOpenChange, open]);

  async function setActive(active: boolean) {
    if (!connection) return;
    try {
      await updateWebhook.mutateAsync({
        workspaceId,
        connectionId: connection.id,
        body: {lifecycle_status: active ? 'active' : 'disabled'},
      });
      toast.success(active ? 'Webhook enabled.' : 'Webhook disabled.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update webhook.');
    }
  }

  async function deleteConnection() {
    if (!connection) return;
    try {
      await deleteWebhook.mutateAsync({workspaceId, connectionId: connection.id});
      toast.success('Webhook deleted.');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete webhook.');
    }
  }

  const title = connection ? connection.name : 'Manage webhook';
  const isMutating = updateWebhook.isPending || deleteWebhook.isPending;
  const handleOpenChange = (nextOpen: boolean) => {
    if (isMutating && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">{title}</ModalTitle>
        <ModalHeader showClose={!isMutating}>
          <div className="flex min-w-0 items-center gap-8">
            <Text size="lg" className="min-w-0 truncate">
              {title}
            </Text>
            {connection ? (
              <ConnectionStatusBadge status={connection.lifecycle_status} className="shrink-0" />
            ) : null}
          </div>
        </ModalHeader>

        {connectionsQuery.isPending ? (
          <ModalBody className="items-center justify-center py-40">
            <ShipfoxLoader size={48} animation="circular" color="orange" background="light" />
          </ModalBody>
        ) : null}

        {connectionsQuery.isError && connectionsQuery.data === undefined ? (
          <ModalBody>
            <QueryLoadError query={connectionsQuery} subject="webhook connections" />
          </ModalBody>
        ) : null}

        {connection ? (
          confirmingDelete ? (
            <WebhookDeleteConfirmContent
              name={connection.name}
              isPending={deleteWebhook.isPending}
              onCancel={() => setConfirmingDelete(false)}
              onConfirm={() => {
                void deleteConnection();
              }}
            />
          ) : (
            <ModalBody className="gap-20">
              <Artifact label="Workflow source">
                <CopyableValue
                  label="workflow source"
                  value={connection.slug}
                  note={
                    <>
                      Paste as <Code as="span">source:</Code> in your workflow trigger.
                    </>
                  }
                />
              </Artifact>
              <Artifact label="Inbound URL">
                <CopyableValue
                  label="inbound URL"
                  value={connection.inbound_url}
                  note="Anyone with this URL can trigger your workflow."
                />
              </Artifact>
              <div className="flex w-full items-start justify-between gap-16 rounded-8 border border-border-neutral-base p-16">
                <div className="flex min-w-0 flex-col gap-4">
                  <Text size="sm" bold>
                    Active
                  </Text>
                  <Text size="sm" className="text-foreground-neutral-muted">
                    Disabled webhooks reject deliveries.
                  </Text>
                </div>
                <Switch
                  aria-label="Set webhook active"
                  checked={connection.lifecycle_status === 'active'}
                  disabled={updateWebhook.isPending}
                  onCheckedChange={(checked) => {
                    void setActive(checked);
                  }}
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
              <div className="flex w-full flex-col gap-12 rounded-8 border border-border-highlights-danger p-16">
                <div className="flex flex-col gap-4">
                  <Text size="sm" bold>
                    Danger zone
                  </Text>
                  <Text size="sm" className="text-foreground-neutral-muted">
                    Delete this webhook and stop accepting deliveries at its inbound URL.
                  </Text>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="w-fit"
                  iconLeft="deleteBinLine"
                  disabled={updateWebhook.isPending}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              </div>
            </ModalBody>
          )
        ) : null}
      </ModalContent>
    </Modal>
  );
}

export function WebhookDeleteConfirmContent({
  name,
  isPending,
  onCancel,
  onConfirm,
}: {
  name: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <ModalBody className="gap-16">
        <Alert variant="error" animated={false}>
          Delete {name}? Deliveries stop immediately and the inbound URL stops working. This cannot
          be undone.
        </Alert>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="danger" isLoading={isPending} onClick={onConfirm}>
          Delete webhook
        </Button>
      </ModalFooter>
    </>
  );
}

function Artifact({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <Text size="sm" bold>
        {label}
      </Text>
      {children}
    </div>
  );
}
