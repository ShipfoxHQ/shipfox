import type {RepositoryDto} from '@shipfox/api-integration-core-dto';
import {Button} from '@shipfox/react-ui/button';
import {Input} from '@shipfox/react-ui/input';
import {Label} from '@shipfox/react-ui/label';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
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
  searchValue,
  onSearchChange,
  searchDisabled,
}: {
  repositories: RepositoryDto[];
  selectedRepositoryId: string | undefined;
  onSelect: (repositoryId: string) => void;
  isLoading: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchDisabled?: boolean;
}) {
  const labelId = useId();
  const showSearch = onSearchChange !== undefined;

  return (
    <div className="flex flex-col gap-10">
      <Label id={labelId}>Repository</Label>

      {showSearch ? (
        <Input
          type="search"
          placeholder="Search repositories…"
          aria-label="Search repositories"
          value={searchValue ?? ''}
          onChange={(event) => onSearchChange?.(event.target.value)}
          disabled={searchDisabled}
        />
      ) : null}

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
