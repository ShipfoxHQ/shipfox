import type {CreateProvisionerTokenResponseDto} from '@shipfox/api-runners-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Button,
  Header,
  Icon,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  RelativeTimeProvider,
  Text,
} from '@shipfox/react-ui';
import {useMemo, useState} from 'react';
import {
  useActiveProvisionersQuery,
  useProvisionerTokensQuery,
} from '#hooks/api/provisioner-tokens.js';
import {
  CreatedProvisionerTokenPanel,
  CreateProvisionerTokenForm,
} from './create-provisioner-token-form.js';
import {
  EmptyProvisionerTokens,
  ProvisionerTokenList,
  ProvisionerTokenTableSkeleton,
} from './provisioner-token-list.js';

export function WorkspaceProvisionerTokensSettingsSection({workspaceId}: {workspaceId: string}) {
  const tokensQuery = useProvisionerTokensQuery(workspaceId);
  const activeProvisionersQuery = useActiveProvisionersQuery(workspaceId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreateProvisionerTokenResponseDto | null>(null);
  const tokens = tokensQuery.data?.tokens ?? [];
  const activeIds = useMemo(
    () => new Set(activeProvisionersQuery.data?.provisioners.map((provisioner) => provisioner.id)),
    [activeProvisionersQuery.data],
  );

  function handleOpenChange(nextOpen: boolean) {
    setIsModalOpen(nextOpen);
    if (!nextOpen) {
      setCreatedToken(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-32">
      <section className="flex flex-col gap-16">
        <div className="flex items-center justify-between gap-16 max-[640px]:items-start">
          <div className="flex flex-col gap-4">
            <Header variant="h3">Provisioner registration tokens</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              Let a provisioner (an autoscaler such as the Docker provisioner) connect to this
              workspace and provision runners on demand. The provisioner mints its own short-lived
              runner tokens.
            </Text>
          </div>
          <div className="flex items-center gap-12">
            {(tokensQuery.isFetching && !tokensQuery.isPending) ||
            (activeProvisionersQuery.isFetching && !activeProvisionersQuery.isPending) ? (
              <Icon
                name="loader4Line"
                className="mt-2 size-18 text-foreground-neutral-muted"
                aria-label="Refreshing provisioner tokens"
              />
            ) : null}
            <Modal open={isModalOpen} onOpenChange={handleOpenChange}>
              <ModalTrigger asChild>
                <Button>Create token</Button>
              </ModalTrigger>
              <ModalContent aria-describedby={undefined}>
                <ModalTitle className="sr-only">Create provisioner registration token</ModalTitle>
                <ModalHeader>
                  <Text
                    size="lg"
                    aria-hidden="true"
                    className="overflow-ellipsis overflow-hidden whitespace-nowrap"
                  >
                    Create provisioner registration token
                  </Text>
                </ModalHeader>
                {createdToken ? (
                  <ModalBody className="gap-16">
                    <CreatedProvisionerTokenPanel token={createdToken} />
                  </ModalBody>
                ) : (
                  <CreateProvisionerTokenForm
                    workspaceId={workspaceId}
                    onCreated={setCreatedToken}
                  />
                )}
              </ModalContent>
            </Modal>
          </div>
        </div>

        {tokensQuery.isPending ? <ProvisionerTokenTableSkeleton /> : null}

        {tokensQuery.isError && tokensQuery.data === undefined ? (
          <QueryLoadError query={tokensQuery} subject="provisioner registration tokens" />
        ) : null}

        {tokensQuery.data !== undefined && tokens.length === 0 ? <EmptyProvisionerTokens /> : null}

        {tokens.length > 0 ? (
          <RelativeTimeProvider>
            <ProvisionerTokenList workspaceId={workspaceId} tokens={tokens} activeIds={activeIds} />
          </RelativeTimeProvider>
        ) : null}
      </section>
    </div>
  );
}
