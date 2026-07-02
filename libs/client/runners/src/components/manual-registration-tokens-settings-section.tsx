import type {CreateManualRegistrationTokenResponseDto} from '@shipfox/api-runners-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@shipfox/react-ui/modal';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import {useManualRegistrationTokensQuery} from '#hooks/api/manual-registration-tokens.js';
import {
  CreatedManualRegistrationTokenPanel,
  CreateManualRegistrationTokenForm,
} from './create-manual-registration-token-form.js';
import {
  EmptyManualRegistrationTokens,
  ManualRegistrationTokenList,
  ManualRegistrationTokenTableSkeleton,
} from './manual-registration-token-list.js';

export function WorkspaceManualRegistrationTokensSettingsSection({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const tokensQuery = useManualRegistrationTokensQuery(workspaceId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreateManualRegistrationTokenResponseDto | null>(
    null,
  );
  const tokens = tokensQuery.data?.manual_registration_tokens ?? [];

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
            <Header variant="h3">Runner registration tokens</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              Register individual runner agents that run jobs directly in this workspace. Tokens are
              reusable until revoked.
            </Text>
          </div>
          <div className="flex items-center gap-12">
            {tokensQuery.isFetching && !tokensQuery.isPending ? (
              <Icon
                name="loader4Line"
                className="mt-2 size-18 text-foreground-neutral-muted"
                aria-label="Refreshing tokens"
              />
            ) : null}
            <Modal open={isModalOpen} onOpenChange={handleOpenChange}>
              <ModalTrigger asChild>
                <Button>Create token</Button>
              </ModalTrigger>
              <ModalContent aria-describedby={undefined}>
                <ModalTitle className="sr-only">Create manual registration token</ModalTitle>
                <ModalHeader>
                  <Text
                    size="lg"
                    aria-hidden="true"
                    className="overflow-ellipsis overflow-hidden whitespace-nowrap"
                  >
                    Create manual registration token
                  </Text>
                </ModalHeader>
                {createdToken ? (
                  <ModalBody className="gap-16">
                    <CreatedManualRegistrationTokenPanel token={createdToken} />
                  </ModalBody>
                ) : (
                  <CreateManualRegistrationTokenForm
                    workspaceId={workspaceId}
                    onCreated={setCreatedToken}
                  />
                )}
              </ModalContent>
            </Modal>
          </div>
        </div>

        {tokensQuery.isPending ? <ManualRegistrationTokenTableSkeleton /> : null}

        {tokensQuery.isError && tokensQuery.data === undefined ? (
          <QueryLoadError query={tokensQuery} subject="manual registration tokens" />
        ) : null}

        {tokensQuery.data !== undefined && tokens.length === 0 ? (
          <EmptyManualRegistrationTokens />
        ) : null}

        {tokens.length > 0 ? (
          <ManualRegistrationTokenList workspaceId={workspaceId} tokens={tokens} />
        ) : null}
      </section>
    </div>
  );
}
