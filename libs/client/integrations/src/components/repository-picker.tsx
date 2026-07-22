import {Button} from '@shipfox/react-ui/button';
import {Input} from '@shipfox/react-ui/input';
import {Label} from '@shipfox/react-ui/label';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';
import type {Repository} from '#core/models.js';

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
  repositories: Repository[];
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
      <Label id={labelId} className="sr-only">
        Repository
      </Label>

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
          className="grid grid-cols-2 gap-8 min-[1200px]:grid-cols-3 max-[760px]:grid-cols-1"
        >
          {repositories.map((repository) => (
            <RadioGroupItem
              key={repository.externalRepositoryId}
              value={repository.externalRepositoryId}
              className="p-12"
            >
              <span className="flex min-w-0 items-center justify-between gap-10">
                <Text as="span" size="sm" bold className="truncate">
                  {repository.fullName}
                </Text>
                <Text as="span" size="xs" className="shrink-0 text-foreground-neutral-muted">
                  {repository.defaultBranch}
                </Text>
              </span>
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
