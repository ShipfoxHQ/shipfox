import type {RepositoryDto} from '@shipfox/api-integration-core-dto';
import {Button, Label, RadioGroup, RadioGroupItem, Skeleton, Text} from '@shipfox/react-ui';
import {useId} from 'react';

export function RepositoryPicker({
  repositories,
  selectedRepositoryId,
  onSelect,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  emptyMessage = 'No repositories found.',
}: {
  repositories: RepositoryDto[];
  selectedRepositoryId: string | undefined;
  onSelect: (repositoryId: string) => void;
  isLoading: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
}) {
  const labelId = useId();

  return (
    <div className="flex flex-col gap-10">
      <Label id={labelId}>Repository</Label>

      {isLoading ? <Skeleton className="h-58 w-full" /> : null}

      {!isLoading && repositories.length === 0 ? (
        <div className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-14">
          <Text size="sm">{emptyMessage}</Text>
        </div>
      ) : null}

      {repositories.length > 0 ? (
        <RadioGroup
          aria-labelledby={labelId}
          value={selectedRepositoryId ?? ''}
          onValueChange={onSelect}
        >
          {repositories.map((repository) => (
            <RadioGroupItem
              key={repository.external_repository_id}
              value={repository.external_repository_id}
            >
              <Text size="sm" bold>
                {repository.full_name}
              </Text>
              <Text size="xs" className="text-foreground-neutral-muted">
                {repository.external_repository_id} · {repository.default_branch}
              </Text>
            </RadioGroupItem>
          ))}
        </RadioGroup>
      ) : null}

      {hasNextPage && onLoadMore ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isLoading={isFetchingNextPage ?? false}
          onClick={onLoadMore}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
