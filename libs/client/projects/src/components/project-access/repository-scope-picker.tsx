import {Button} from '@shipfox/react-ui/button';
import {Checkbox} from '@shipfox/react-ui/checkbox';
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
import {Text} from '@shipfox/react-ui/typography';
import {useEffect, useId, useState} from 'react';
import {type AccessResource, REPOSITORY_RESOURCE_KIND} from '#core/project-access.js';
import {useScopeResourcesInfiniteQuery} from '#hooks/api/project-access.js';

export interface RepositoryScopePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  connectionName: string;
  selected: readonly AccessResource[];
  /** A linked project's config repository, always included and never removable. */
  lockedExternalId?: string | undefined;
  onToggle: (resource: AccessResource, listed: boolean) => void;
}

/** Picks the repositories a project is limited to on one connection. Each toggle applies at once. */
export function RepositoryScopePicker({
  open,
  onOpenChange,
  connectionName,
  ...props
}: RepositoryScopePickerProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Select repositories</ModalTitle>
        <ModalHeader title={`Select repositories on ${connectionName}`} />
        {open ? <RepositoryScopeList {...props} /> : null}
        <ModalFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function RepositoryScopeList({
  connectionId,
  selected,
  lockedExternalId,
  onToggle,
}: Omit<RepositoryScopePickerProps, 'open' | 'onOpenChange' | 'connectionName'>) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const resourcesQuery = useScopeResourcesInfiniteQuery({
    connectionId,
    kind: REPOSITORY_RESOURCE_KIND,
    search: debouncedSearch,
  });
  const resources = resourcesQuery.data?.pages.flatMap((page) => page.resources) ?? [];
  const selectedIds = new Set(selected.map((resource) => resource.externalId));

  return (
    <ModalBody className="gap-group">
      <Input
        type="search"
        placeholder="Search repositories…"
        aria-label="Search repositories"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-[320px] overflow-y-auto rounded-8 border border-border-neutral-base scrollbar">
        <RepositoryOptions
          query={resourcesQuery}
          resources={resources}
          search={debouncedSearch}
          selectedIds={selectedIds}
          lockedExternalId={lockedExternalId}
          onToggle={onToggle}
        />
        {resourcesQuery.hasNextPage ? (
          <div className="flex justify-center border-t border-border-neutral-base p-panel-compact">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              isLoading={resourcesQuery.isFetchingNextPage}
              onClick={() => {
                void resourcesQuery.fetchNextPage();
              }}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </ModalBody>
  );
}

function RepositoryOptions({
  query,
  resources,
  search,
  selectedIds,
  lockedExternalId,
  onToggle,
}: {
  query: ReturnType<typeof useScopeResourcesInfiniteQuery>;
  resources: AccessResource[];
  search: string;
  selectedIds: ReadonlySet<string>;
  lockedExternalId: string | undefined;
  onToggle: (resource: AccessResource, listed: boolean) => void;
}) {
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-cluster p-panel-compact" aria-busy="true">
        <Skeleton className="h-20 w-1/2 rounded-4" />
        <Skeleton className="h-20 w-1/3 rounded-4" />
        <Skeleton className="h-20 w-2/5 rounded-4" />
      </div>
    );
  }
  if (query.isError && resources.length === 0) {
    return (
      <LoadErrorState
        title="Couldn't load repositories"
        description="The connection didn't answer."
        onRetry={() => {
          void query.refetch();
        }}
        retrying={query.isRefetching}
        retryLabel="Retry loading repositories"
      />
    );
  }
  if (resources.length === 0) {
    return (
      <Text size="sm" className="px-row py-row">
        {search
          ? `No repositories matching "${search}".`
          : 'No repositories visible to this connection.'}
      </Text>
    );
  }
  return (
    <ul aria-label="Repositories">
      {resources.map((resource) => (
        <RepositoryOption
          key={resource.externalId}
          resource={resource}
          checked={resource.externalId === lockedExternalId || selectedIds.has(resource.externalId)}
          locked={resource.externalId === lockedExternalId}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

function RepositoryOption({
  resource,
  checked,
  locked,
  onToggle,
}: {
  resource: AccessResource;
  checked: boolean;
  locked: boolean;
  onToggle: (resource: AccessResource, listed: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-cluster border-b border-border-neutral-base px-row py-row last:border-b-0">
      <Checkbox
        id={id}
        checked={checked}
        disabled={locked}
        onCheckedChange={(next) => onToggle(resource, next === true)}
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-inline">
        <Text as="span" size="sm" bold className="truncate">
          {resource.displayName}
        </Text>
        {locked ? (
          <Text as="span" size="xs" className="shrink-0 text-foreground-neutral-muted">
            Config repository
          </Text>
        ) : null}
      </label>
    </li>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}
