import type {ConfigCommit} from '@shipfox/client-projects';
import {Button} from '@shipfox/react-ui/button';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {PanelRow} from '@shipfox/react-ui/panel';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {shortCommitId} from '#core/automations.js';
import {CONFIG_ROOT, commitSubject} from '#core/config-files.js';

export interface ConfigFileHistoryProps {
  path: string;
  commits: readonly ConfigCommit[];
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}

/** One line per commit that changed `path`, newest first. */
export function ConfigFileHistory({
  path,
  commits,
  isPending,
  isError,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onRetry,
  onLoadMore,
}: ConfigFileHistoryProps) {
  if (isPending) {
    return (
      <div role="status" aria-label="Loading history" className="flex flex-col">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="border-b border-border-neutral-base px-row py-row last:border-b-0"
          >
            <Skeleton className="h-20 w-full rounded-4" />
          </div>
        ))}
      </div>
    );
  }
  if (isError && commits.length === 0) {
    return (
      <LoadErrorState
        title="Couldn't load history"
        description="The commit list could not be read from the repository."
        onRetry={onRetry}
        retryLabel="Retry loading history"
        variant="panel"
      />
    );
  }
  if (commits.length === 0) {
    return (
      <EmptyState
        icon="historyLine"
        title="No history"
        description={
          path === CONFIG_ROOT
            ? 'No commits changed .shipfox yet.'
            : 'No commits changed this path.'
        }
        variant="panel"
      />
    );
  }

  return (
    <div className="flex flex-col">
      <ol
        aria-label={`History of ${path}`}
        className="flex flex-col divide-y divide-border-neutral-base"
      >
        {commits.map((commit) => (
          <li key={commit.oid} className="flex flex-col">
            <ConfigCommitRow commit={commit} />
          </li>
        ))}
      </ol>
      {hasNextPage ? (
        <div className="flex items-center justify-center gap-inline border-t border-border-neutral-base px-row py-row">
          {isFetchNextPageError ? (
            <Text size="sm" role="status" className="text-foreground-neutral-muted">
              Could not load more commits.
            </Text>
          ) : null}
          <Button size="sm" variant="secondary" isLoading={isFetchingNextPage} onClick={onLoadMore}>
            {isFetchNextPageError ? 'Retry' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const COMMIT_ROW_CLASS_NAME =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center justify-normal gap-group sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,160px)_auto]';

function ConfigCommitRow({commit}: {commit: ConfigCommit}) {
  const content = (
    <>
      <Code variant="label" className="text-foreground-neutral-muted" title={commit.oid}>
        {shortCommitId(commit.oid)}
      </Code>
      <Text size="sm" className="truncate">
        {commitSubject(commit.message)}
      </Text>
      <Text size="sm" className="hidden truncate text-foreground-neutral-muted sm:block">
        {commit.authorName}
      </Text>
      <Text size="sm" className="whitespace-nowrap text-right text-foreground-neutral-muted">
        <RelativeTime value={commit.authoredAt} />
      </Text>
    </>
  );

  // A managed commit has no page to open until a diff view exists, and only a row with an
  // action takes the hover wash.
  if (!commit.htmlUrl) {
    return (
      <PanelRow className={cn(COMMIT_ROW_CLASS_NAME, 'hover:bg-background-neutral-base')}>
        {content}
      </PanelRow>
    );
  }

  return (
    <PanelRow
      asChild
      className={cn(COMMIT_ROW_CLASS_NAME, 'outline-none focus-visible:shadow-focus-inset')}
    >
      <a href={commit.htmlUrl} target="_blank" rel="noreferrer">
        {content}
      </a>
    </PanelRow>
  );
}
