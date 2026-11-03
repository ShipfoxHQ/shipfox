import {Button} from '@shipfox/react-ui/button';
import {useIsTextTruncated} from '@shipfox/react-ui/hooks';
import {Label} from '@shipfox/react-ui/label';
import {PanelGrid} from '@shipfox/react-ui/panel';
import {RadioGroup, RadioGroupItem, RadioGroupItemSkeleton} from '@shipfox/react-ui/radio-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';
import type {Repository} from '#core/models.js';

const REPOSITORY_SKELETON_WIDTHS = ['w-64', 'w-96', 'w-80', 'w-112'] as const;

export function RepositoryPicker({
  repositories,
  selectedRepositoryId,
  onSelect,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  emptyMessage = 'No repositories found.',
  showDetails = false,
}: {
  repositories: Repository[];
  selectedRepositoryId: string | undefined;
  onSelect: (repositoryId: string) => void;
  isLoading: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
  /** Names each repository by its full name, with its default branch and visibility. */
  showDetails?: boolean;
}) {
  const labelId = useId();

  return (
    <div className="flex min-w-0 flex-col">
      <Label id={labelId} className="sr-only">
        Repository
      </Label>

      {isLoading ? <RepositoryLoadingState /> : null}

      {!isLoading && repositories.length === 0 ? (
        <Text size="sm" className="px-row py-row">
          {emptyMessage}
        </Text>
      ) : null}

      {repositories.length > 0 ? (
        <RadioGroup
          variant="cell"
          aria-labelledby={labelId}
          value={selectedRepositoryId ?? ''}
          onValueChange={onSelect}
        >
          {repositories.map((repository) => (
            <RepositoryCard
              key={repository.externalRepositoryId}
              repository={repository}
              showDetails={showDetails}
            />
          ))}
        </RadioGroup>
      ) : null}

      {hasNextPage && onLoadMore ? (
        <div className="flex justify-center border-t border-border-neutral-base p-panel-compact">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isFetchingNextPage ?? false}
            onClick={onLoadMore}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const VISIBILITY_LABEL: Record<Repository['visibility'], string> = {
  public: 'Public',
  private: 'Private',
  internal: 'Internal',
  unknown: 'Visibility unknown',
};

function RepositoryCard({repository, showDetails}: {repository: Repository; showDetails: boolean}) {
  const label = showDetails ? repository.fullName : repository.name;
  const {ref: nameRef, isTruncated} = useIsTextTruncated<HTMLSpanElement>(label);
  const visibility = VISIBILITY_LABEL[repository.visibility];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RadioGroupItem value={repository.externalRepositoryId}>
          <span ref={nameRef} className="block min-w-0 truncate">
            <Text as="span" size="sm" bold>
              {label}
            </Text>
          </span>
          {showDetails ? (
            <Text as="span" size="xs" className="truncate text-foreground-neutral-muted">
              <Code as="span" variant="label">
                {repository.defaultBranch}
              </Code>
              {` · ${visibility}`}
            </Text>
          ) : null}
        </RadioGroupItem>
      </TooltipTrigger>
      {isTruncated ? <TooltipContent>{label}</TooltipContent> : null}
    </Tooltip>
  );
}

function RepositoryLoadingState() {
  return (
    <>
      <div role="status" className="sr-only">
        Loading repositories.
      </div>
      <PanelGrid as="div" aria-hidden="true">
        {REPOSITORY_SKELETON_WIDTHS.map((width) => (
          <RadioGroupItemSkeleton key={width} variant="cell" labelClassName={width} />
        ))}
      </PanelGrid>
    </>
  );
}
