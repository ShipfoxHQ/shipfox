import type {CreateRunnerTokenResponseDto} from '@shipfox/api-runners-dto';
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
  Text,
} from '@shipfox/react-ui';
import {useState} from 'react';
import {useRunnerTokensQuery} from '#hooks/api/runner-tokens.js';
import {CreatedRunnerTokenPanel, CreateRunnerTokenForm} from './create-runner-token-form.js';
import {EmptyRunnerTokens, RunnerTokenList, RunnerTokenTableSkeleton} from './runner-token-list.js';

export function WorkspaceRunnerTokensSettingsSection({workspaceId}: {workspaceId: string}) {
  const tokensQuery = useRunnerTokensQuery(workspaceId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreateRunnerTokenResponseDto | null>(null);
  const tokens = tokensQuery.data?.tokens ?? [];

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
            <Header variant="h3">Runners</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              Tokens used by machines to request and complete jobs.
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
                <ModalTitle className="sr-only">Create runner token</ModalTitle>
                <ModalHeader>
                  <Text
                    size="lg"
                    aria-hidden="true"
                    className="overflow-ellipsis overflow-hidden whitespace-nowrap"
                  >
                    Create runner token
                  </Text>
                </ModalHeader>
                {createdToken ? (
                  <ModalBody className="gap-16">
                    <CreatedRunnerTokenPanel token={createdToken} />
                  </ModalBody>
                ) : (
                  <CreateRunnerTokenForm workspaceId={workspaceId} onCreated={setCreatedToken} />
                )}
              </ModalContent>
            </Modal>
          </div>
        </div>

        {tokensQuery.isPending ? <RunnerTokenTableSkeleton /> : null}

        {tokensQuery.isError && tokensQuery.data === undefined ? (
          <QueryLoadError query={tokensQuery} subject="runner tokens" />
        ) : null}

        {tokensQuery.data !== undefined && tokens.length === 0 ? <EmptyRunnerTokens /> : null}

        {tokens.length > 0 ? <RunnerTokenList workspaceId={workspaceId} tokens={tokens} /> : null}
      </section>
    </div>
  );
}
