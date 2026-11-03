import {
  ConnectionPicker,
  type Repository,
  RepositoryPicker,
  useRepositoriesInfiniteQuery,
  useSourceConnectionsQuery,
} from '@shipfox/client-integrations';
import {
  type ConfigMoveCheck,
  configMoveErrorCopy,
  type ProjectErrorCopy,
  useCheckProjectConfigMoveMutation,
  useMoveProjectConfigMutation,
} from '@shipfox/client-projects';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Icon} from '@shipfox/react-ui/icon';
import {Input} from '@shipfox/react-ui/input';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useEffect, useRef, useState} from 'react';

export interface MoveToRepositoryDialogProps {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Moves a managed project's config to a repository: pick a connection and a repository, check it
 * on selection, read what changes, and confirm. The dialog stays open while the move runs.
 */
export function MoveToRepositoryDialog({
  projectId,
  workspaceId,
  workspaceSlug,
  open,
  onOpenChange,
}: MoveToRepositoryDialogProps) {
  const move = useMoveProjectConfigMutation();
  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (move.isPending && !nextOpen) return;
        if (!nextOpen) move.reset();
        onOpenChange(nextOpen);
      }}
    >
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Move to your repository</ModalTitle>
        <ModalHeader title="Move to your repository" showClose={!move.isPending} />
        <MoveToRepositoryFlow
          projectId={projectId}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          move={move}
          onClose={() => onOpenChange(false)}
        />
      </ModalContent>
    </Modal>
  );
}

type MoveMutation = ReturnType<typeof useMoveProjectConfigMutation>;

interface SelectedRepository {
  connectionId: string;
  repository: Repository;
}

function MoveToRepositoryFlow({
  projectId,
  workspaceId,
  workspaceSlug,
  move,
  onClose,
}: {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  move: MoveMutation;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<{
    selected: SelectedRepository;
    check: ConfigMoveCheck;
  } | null>(null);
  const [selected, setSelected] = useState<SelectedRepository | null>(null);

  async function confirmMove() {
    if (!confirming) return;
    try {
      await move.mutateAsync({
        projectId,
        connectionId: confirming.selected.connectionId,
        externalRepositoryId: confirming.selected.repository.externalRepositoryId,
      });
      onClose();
    } catch {
      // The confirm screen shows the refusal from the mutation state.
    }
  }

  if (confirming) {
    return (
      <ConfirmMoveStep
        check={confirming.check}
        isMoving={move.isPending}
        error={
          move.isError
            ? configMoveErrorCopy(move.error, {
                repositoryName: confirming.check.repository.fullName,
              })
            : null
        }
        onBack={() => {
          move.reset();
          setConfirming(null);
        }}
        onConfirm={() => {
          void confirmMove();
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <ChooseRepositoryStep
      projectId={projectId}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      selected={selected}
      onSelect={setSelected}
      onContinue={(check) => {
        if (selected) setConfirming({selected, check});
      }}
      onCancel={onClose}
    />
  );
}

function ChooseRepositoryStep({
  projectId,
  workspaceId,
  workspaceSlug,
  selected,
  onSelect,
  onContinue,
  onCancel,
}: {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  selected: SelectedRepository | null;
  onSelect: (selected: SelectedRepository | null) => void;
  onContinue: (check: ConfigMoveCheck) => void;
  onCancel: () => void;
}) {
  const connectionsQuery = useSourceConnectionsQuery(workspaceId);
  const connections = connectionsQuery.data ?? [];
  const [chosenConnectionId, setChosenConnectionId] = useState<string | undefined>(
    selected?.connectionId,
  );
  // With one connection, the dialog skips choosing it.
  const connectionId =
    chosenConnectionId ?? (connections.length === 1 ? connections[0]?.id : undefined);
  const check = useSelectionCheck(projectId, selected);

  if (connectionsQuery.isPending) {
    return (
      <ModalBody className="gap-cluster" aria-busy="true">
        <Skeleton className="h-20 w-1/2 rounded-4" />
        <Skeleton className="h-20 w-1/3 rounded-4" />
      </ModalBody>
    );
  }
  if (connectionsQuery.isError) {
    return (
      <ModalBody>
        <LoadErrorState
          title="Couldn't load connections"
          description="Shipfox couldn't list your source control connections."
          onRetry={() => {
            void connectionsQuery.refetch();
          }}
          retrying={connectionsQuery.isRefetching}
          retryLabel="Retry loading connections"
        />
      </ModalBody>
    );
  }
  if (connections.length === 0) {
    return <NoConnectionStep workspaceSlug={workspaceSlug} onCancel={onCancel} />;
  }

  return (
    <>
      <ModalBody className="gap-group">
        <Text size="sm" className="text-foreground-neutral-subtle">
          Shipfox opens a pull request that adds this project's .shipfox/ directory to the
          repository you pick.
        </Text>

        {connections.length > 1 ? (
          <section aria-label="Connection" className="flex w-full flex-col gap-inline">
            <Text size="sm" bold>
              Connection
            </Text>
            <div className="overflow-hidden rounded-8 border border-border-neutral-base">
              <ConnectionPicker
                connections={connections}
                selectedConnectionId={connectionId}
                onSelect={(nextConnectionId) => {
                  setChosenConnectionId(nextConnectionId);
                  onSelect(null);
                }}
              />
            </div>
          </section>
        ) : null}

        {connectionId ? (
          <RepositorySection
            connectionId={connectionId}
            selectedRepositoryId={
              selected?.connectionId === connectionId
                ? selected.repository.externalRepositoryId
                : undefined
            }
            onSelect={(repository) => onSelect({connectionId, repository})}
          />
        ) : null}

        {selected && check.isChecking ? (
          <Text
            size="sm"
            role="status"
            className="flex items-center gap-inline text-foreground-neutral-subtle"
          >
            <Icon name="spinner" className="size-14 shrink-0" aria-hidden="true" />
            Checking {selected.repository.fullName}…
          </Text>
        ) : null}
        {check.refusal ? (
          <MoveRefusal key={refusalKey(check.refusal)} copy={check.refusal} />
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!check.passed}
          onClick={() => {
            if (check.passed) onContinue(check.passed);
          }}
        >
          Continue
        </Button>
      </ModalFooter>
    </>
  );
}

/** Runs the move checks on each new selection, and answers for the current one only. */
function useSelectionCheck(projectId: string, selected: SelectedRepository | null) {
  const check = useCheckProjectConfigMoveMutation();
  const {mutate: runCheck} = check;
  useEffect(() => {
    if (!selected) return;
    runCheck({
      projectId,
      connectionId: selected.connectionId,
      externalRepositoryId: selected.repository.externalRepositoryId,
    });
  }, [projectId, runCheck, selected]);

  const isCurrent =
    selected !== null &&
    check.variables?.connectionId === selected.connectionId &&
    check.variables.externalRepositoryId === selected.repository.externalRepositoryId;
  return {
    isChecking: isCurrent && check.isPending,
    refusal:
      isCurrent && check.isError
        ? configMoveErrorCopy(check.error, {repositoryName: selected.repository.fullName})
        : null,
    passed: isCurrent && check.isSuccess ? check.data : null,
  };
}

function RepositorySection({
  connectionId,
  selectedRepositoryId,
  onSelect,
}: {
  connectionId: string;
  selectedRepositoryId: string | undefined;
  onSelect: (repository: Repository) => void;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const repositoriesQuery = useRepositoriesInfiniteQuery(
    connectionId,
    debouncedSearch ? {search: debouncedSearch} : undefined,
  );
  const repositories = repositoriesQuery.data?.pages.flatMap((page) => page.repositories) ?? [];

  return (
    <section aria-label="Repository" className="flex w-full flex-col gap-inline">
      <div className="flex flex-wrap items-center justify-between gap-cluster">
        <Text size="sm" bold>
          Repository
        </Text>
        <Input
          type="search"
          placeholder="Search repositories…"
          aria-label="Search repositories"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full max-w-[240px]"
        />
      </div>
      <div className="max-h-[280px] overflow-y-auto rounded-8 border border-border-neutral-base scrollbar">
        <RepositoryPicker
          repositories={repositories}
          selectedRepositoryId={selectedRepositoryId}
          onSelect={(externalRepositoryId) => {
            const repository = repositories.find(
              (candidate) => candidate.externalRepositoryId === externalRepositoryId,
            );
            if (repository) onSelect(repository);
          }}
          isLoading={repositoriesQuery.isPending}
          isFetchingNextPage={repositoriesQuery.isFetchingNextPage}
          hasNextPage={repositoriesQuery.hasNextPage}
          onLoadMore={() => {
            void repositoriesQuery.fetchNextPage();
          }}
          emptyMessage={
            debouncedSearch
              ? `No repositories matching "${debouncedSearch}".`
              : 'No repositories visible to this connection.'
          }
          showDetails
        />
      </div>
    </section>
  );
}

function NoConnectionStep({
  workspaceSlug,
  onCancel,
}: {
  workspaceSlug: string;
  onCancel: () => void;
}) {
  return (
    <>
      <ModalBody className="gap-group">
        <Text size="sm">
          Connect GitHub first. The move opens a pull request on a repository the connection can
          see.
        </Text>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button asChild>
          <Link to="/w/$workspaceSlug/integrations" params={{workspaceSlug}}>
            Go to Integrations
          </Link>
        </Button>
      </ModalFooter>
    </>
  );
}

function ConfirmMoveStep({
  check,
  isMoving,
  error,
  onBack,
  onConfirm,
  onClose,
}: {
  check: ConfigMoveCheck;
  isMoving: boolean;
  error: ProjectErrorCopy | null;
  onBack: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const {repository, fileCount} = check;
  const files = fileCount === 1 ? '1 file' : `${fileCount} files`;

  if (isMoving) {
    return (
      <ModalBody className="gap-group">
        <Text size="sm" role="status" className="flex items-center gap-inline">
          <Icon name="spinner" className="size-16 shrink-0" aria-hidden="true" />
          Opening a pull request on {repository.fullName}…
        </Text>
        <Text size="sm" className="text-foreground-neutral-subtle">
          Keep this dialog open. The move finishes when the pull request opens.
        </Text>
      </ModalBody>
    );
  }

  return (
    <>
      <ModalBody className="gap-group">
        <Text size="sm">
          Shipfox opens a pull request that adds {files} to{' '}
          <Code as="span">{repository.fullName}</Code> on{' '}
          <Code as="span">{repository.defaultBranch}</Code>. The move takes effect when the pull
          request opens, and it can't be undone.
        </Text>
        <ul
          aria-label="What changes"
          className="flex w-full flex-col divide-y divide-border-neutral-base rounded-8 border border-border-neutral-base"
        >
          <ConsequenceItem>
            Workflows keep running on today's config until the merge. Triggers, schedules, and run
            numbers carry over.
          </ConsequenceItem>
          <ConsequenceItem>
            Config can't change until the merge. Files stay empty until then, and past commits stay
            behind.
          </ConsequenceItem>
          <ConsequenceItem>
            Jobs and tools change now. Jobs with no checkout start checking out{' '}
            {repository.fullName}.
          </ConsequenceItem>
          <ConsequenceItem>
            Everyone with access to {repository.fullName} can read the config.
            {VISIBILITY_NOTE[repository.visibility]}
          </ConsequenceItem>
        </ul>
        {error ? <MoveRefusal key={refusalKey(error)} copy={error} /> : null}
      </ModalBody>
      <ModalFooter>
        {error ? (
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onConfirm}>
          Move to {repository.fullName}
        </Button>
      </ModalFooter>
    </>
  );
}

const VISIBILITY_NOTE: Record<ConfigMoveCheck['repository']['visibility'], string> = {
  public: ' The repository is public, so anyone can read it.',
  private: ' The repository is private.',
  internal: ' The repository is internal to its organization.',
  unknown: '',
};

function ConsequenceItem({children}: {children: ReactNode}) {
  return (
    <li className="px-row py-row">
      <Text size="sm">{children}</Text>
    </li>
  );
}

function refusalKey(copy: ProjectErrorCopy): string {
  return `${copy.title}\n${copy.message}`;
}

/**
 * A refusal takes focus when it appears, so a screen reader hears why Continue stays disabled.
 * Callers key it by its copy, so a different refusal mounts and takes focus again.
 */
function MoveRefusal({copy}: {copy: ProjectErrorCopy}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Callout role="alert" type="error">
      <div ref={ref} tabIndex={-1} className="flex min-w-0 flex-col gap-tight outline-none">
        <Text size="sm" bold>
          {copy.title}
        </Text>
        <Text size="sm">{copy.message}</Text>
      </div>
    </Callout>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
