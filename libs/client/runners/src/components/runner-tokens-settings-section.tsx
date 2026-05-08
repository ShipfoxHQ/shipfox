import type {CreateRunnerTokenResponseDto} from '@shipfox/api-runners-dto';
import {
  Alert,
  Button,
  Header,
  Icon,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Text,
} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {type FormEvent, useState} from 'react';
import {
  runnerTokenQueryKeys,
  useCreateRunnerTokenMutation,
  useRunnerTokensQuery,
} from '#hooks/api/runner-tokens.js';
import {
  CREATE_RUNNER_TOKEN_FORM_ID,
  CreatedRunnerTokenPanel,
  CreateRunnerTokenForm,
  type RunnerTokenExpirationOption,
} from './create-runner-token-form.js';
import {runnerTokenErrorMessage} from './runner-token-errors.js';
import {EmptyRunnerTokens, RunnerTokenList, RunnerTokenTableSkeleton} from './runner-token-list.js';

export function WorkspaceRunnerTokensSettingsSection({workspaceId}: {workspaceId: string}) {
  const queryClient = useQueryClient();
  const tokensQuery = useRunnerTokensQuery(workspaceId);
  const createToken = useCreateRunnerTokenMutation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreateRunnerTokenResponseDto | null>(null);
  const [name, setName] = useState('');
  const [expiration, setExpiration] = useState<RunnerTokenExpirationOption>('86400');
  const tokens = tokensQuery.data?.tokens ?? [];

  function resetModalState() {
    setCreatedToken(null);
    setName('');
    setExpiration('86400');
    createToken.reset();
  }

  function handleOpenChange(nextOpen: boolean) {
    setIsModalOpen(nextOpen);
    if (!nextOpen) {
      resetModalState();
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const body = {
      ...(trimmedName ? {name: trimmedName} : {}),
      ...(expiration === 'never' ? {} : {ttl_seconds: Number(expiration)}),
    };

    try {
      const token = await createToken.mutateAsync({workspaceId, body});
      setCreatedToken(token);
      await queryClient.invalidateQueries({queryKey: runnerTokenQueryKeys.list(workspaceId)});
    } catch {
      // React Query stores the error for the inline alert below.
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
                <ModalHeader title="Create runner token" />
                <ModalBody className="gap-16">
                  {createdToken ? (
                    <CreatedRunnerTokenPanel
                      token={createdToken}
                      onDismiss={() => handleOpenChange(false)}
                    />
                  ) : (
                    <>
                      <CreateRunnerTokenForm
                        name={name}
                        expiration={expiration}
                        onNameChange={setName}
                        onExpirationChange={setExpiration}
                        onSubmit={handleCreate}
                      />
                      {createToken.isError ? (
                        <Alert variant="error" animated={false}>
                          <div className="flex flex-col gap-8">
                            <Text size="sm" bold>
                              Could not create token
                            </Text>
                            <Text size="sm">{runnerTokenErrorMessage(createToken.error)}</Text>
                          </div>
                        </Alert>
                      ) : null}
                    </>
                  )}
                </ModalBody>
                {!createdToken ? (
                  <ModalFooter>
                    <Button
                      type="submit"
                      form={CREATE_RUNNER_TOKEN_FORM_ID}
                      isLoading={createToken.isPending}
                    >
                      Create token
                    </Button>
                  </ModalFooter>
                ) : null}
              </ModalContent>
            </Modal>
          </div>
        </div>

        {tokensQuery.isPending ? <RunnerTokenTableSkeleton /> : null}

        {tokensQuery.isError ? (
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not load tokens
              </Text>
              <Text size="sm">{runnerTokenErrorMessage(tokensQuery.error)}</Text>
              <Button size="sm" variant="secondary" onClick={() => tokensQuery.refetch()}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : null}

        {!tokensQuery.isPending && !tokensQuery.isError && tokens.length === 0 ? (
          <EmptyRunnerTokens />
        ) : null}

        {tokens.length > 0 ? <RunnerTokenList workspaceId={workspaceId} tokens={tokens} /> : null}
      </section>
    </div>
  );
}
