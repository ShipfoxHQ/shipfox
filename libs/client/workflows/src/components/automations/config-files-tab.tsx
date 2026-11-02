import {ApiError} from '@shipfox/client-api';
import {
  type ConfigFileEntry,
  type Definition,
  type ProjectConfig,
  useProjectConfigCommitsInfiniteQuery,
  useProjectConfigFileQuery,
  useProjectConfigFilesQuery,
} from '@shipfox/client-projects';
import {Button} from '@shipfox/react-ui/button';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {Panel, PanelHeader} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useNavigate} from '@tanstack/react-router';
import {type ReactNode, useMemo, useState} from 'react';
import {
  buildConfigTree,
  CONFIG_ROOT,
  type ConfigSelection,
  configAncestorPaths,
  configEntryProblem,
  configReadProblem,
  resolveConfigSelection,
} from '#core/config-files.js';
import {ConfigFileCode, ConfigFileNotice} from './config-file-content.js';
import {ConfigFileHistory} from './config-file-history.js';
import {
  CONFIG_FILES_ROUTE,
  ConfigFileLink,
  type ConfigFileView,
  configFileSearch,
} from './config-file-link.js';
import {ConfigFileTree} from './config-file-tree.js';

export interface ConfigFilesTabProps {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  config: ProjectConfig | undefined;
  isConfigPending: boolean;
  onRetryConfig: () => void;
  definitions: readonly Definition[];
  /** The selected file or folder under `.shipfox`, or null for none. */
  path: string | null;
  view: ConfigFileView;
}

/** The `.shipfox/` tree on the default branch, pinned to the head commit, beside a reader. */
export function ConfigFilesTab({
  projectId,
  workspaceSlug,
  projectSlug,
  config,
  isConfigPending,
  onRetryConfig,
  definitions,
  path,
  view,
}: ConfigFilesTabProps) {
  const commit = config?.head?.commit;
  const filesQuery = useProjectConfigFilesQuery({projectId, commit});

  if (isConfigPending || (commit && filesQuery.isPending)) {
    return (
      <Panel aria-busy="true" aria-label="Loading config files" className="p-panel-compact">
        <div className="flex flex-col gap-cluster">
          <Skeleton className="h-20 w-1/4 rounded-4" />
          <Skeleton className="h-20 w-1/3 rounded-4" />
          <Skeleton className="h-20 w-1/5 rounded-4" />
        </div>
      </Panel>
    );
  }
  if (!commit || filesQuery.isError) {
    return (
      <Panel>
        <LoadErrorState
          title="Couldn't load config files"
          description="The repository didn't answer. The source and workflows stay available."
          onRetry={() => {
            if (commit) void filesQuery.refetch();
            else onRetryConfig();
          }}
          retrying={filesQuery.isRefetching}
          retryLabel="Retry loading config files"
          variant="panel"
        />
      </Panel>
    );
  }
  if (!filesQuery.data || filesQuery.data.files.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="folderOpenLine"
          title="No config files"
          description={`There are no files under ${CONFIG_ROOT}/ on ${config?.source.defaultBranch ?? 'the default branch'}.`}
          variant="panel"
        />
      </Panel>
    );
  }

  return (
    <ConfigFilesBrowser
      projectId={projectId}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      commit={commit}
      files={filesQuery.data.files}
      historySupported={config?.historySupported ?? false}
      definitions={definitions}
      path={path}
      view={view}
    />
  );
}

function ConfigFilesBrowser({
  projectId,
  workspaceSlug,
  projectSlug,
  commit,
  files,
  historySupported,
  definitions,
  path,
  view,
}: {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  commit: string;
  files: readonly ConfigFileEntry[];
  historySupported: boolean;
  definitions: readonly Definition[];
  path: string | null;
  view: ConfigFileView;
}) {
  const navigate = useNavigate();
  const root = useMemo(() => buildConfigTree(files), [files]);
  const selection = resolveConfigSelection(path, files);
  const expanded = useExpandedFolders(path);

  function select(nextPath: string) {
    void navigate({
      to: CONFIG_FILES_ROUTE,
      params: {workspaceSlug, projectSlug, _splat: nextPath} as never,
      search: configFileSearch(view) as never,
    });
  }

  return (
    <Panel className="md:grid md:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
      <div className="min-w-0 overflow-x-auto border-b border-border-neutral-base md:border-r md:border-b-0">
        <ConfigFileTree
          root={root}
          expanded={expanded.paths}
          onExpandedChange={expanded.set}
          selectedPath={selection.kind === 'none' ? undefined : selection.path}
          onSelect={select}
        />
      </div>
      <section aria-label="Config file" className="flex min-w-0 flex-col">
        <ConfigSelectionView
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          commit={commit}
          selection={selection}
          historySupported={historySupported}
          definitions={definitions}
          view={view}
        />
      </section>
    </Panel>
  );
}

/** Opens `.shipfox` and `.shipfox/workflows` at first, and every folder above a new selection. */
function useExpandedFolders(path: string | null) {
  const [paths, setPaths] = useState<ReadonlySet<string>>(
    () => new Set([CONFIG_ROOT, `${CONFIG_ROOT}/workflows`, ...openFoldersFor(path)]),
  );
  const [openedFor, setOpenedFor] = useState(path);
  if (path !== openedFor) {
    setOpenedFor(path);
    const missing = openFoldersFor(path).filter((folder) => !paths.has(folder));
    if (missing.length > 0) setPaths(new Set([...paths, ...missing]));
  }
  return {paths, set: setPaths};
}

function openFoldersFor(path: string | null): string[] {
  return path ? configAncestorPaths(path) : [];
}

function ConfigSelectionView({
  projectId,
  workspaceSlug,
  projectSlug,
  commit,
  selection,
  historySupported,
  definitions,
  view,
}: {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  commit: string;
  selection: ConfigSelection;
  historySupported: boolean;
  definitions: readonly Definition[];
  view: ConfigFileView;
}) {
  if (selection.kind === 'none') {
    return (
      <EmptyState
        icon="fileCodeLine"
        title="Select a file"
        description={
          historySupported
            ? 'Pick a file to read it, or a folder to see its history.'
            : 'Pick a file to read it.'
        }
        variant="panel"
        className="flex-1"
      />
    );
  }

  if (selection.kind === 'folder') {
    return (
      <>
        <ConfigSelectionHeader path={selection.path} />
        {historySupported ? (
          <ConfigHistoryView projectId={projectId} commit={commit} path={selection.path} />
        ) : (
          <EmptyState
            icon="folderLine"
            title="Select a file"
            description="Pick a file in this folder to read it."
            variant="panel"
            className="flex-1"
          />
        )}
      </>
    );
  }

  if (selection.kind === 'missing') {
    return (
      <>
        <ConfigSelectionHeader path={selection.path} />
        <ConfigFileNotice problem="not-found" />
      </>
    );
  }

  const showHistory = historySupported && view === 'history';
  const workflow = definitions.find((definition) => definition.configPath === selection.path);
  return (
    <>
      <ConfigSelectionHeader path={selection.path}>
        {workflow ? (
          <Text size="sm" className="truncate text-foreground-neutral-muted">
            Used by workflow{' '}
            <span className="font-medium text-foreground-neutral-base">{workflow.name}</span>
          </Text>
        ) : null}
        {historySupported ? (
          <FileViewToggle
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            path={selection.path}
            view={showHistory ? 'history' : 'code'}
          />
        ) : null}
      </ConfigSelectionHeader>
      {showHistory ? (
        <ConfigHistoryView projectId={projectId} commit={commit} path={selection.path} />
      ) : (
        <ConfigFileCodeView
          projectId={projectId}
          commit={commit}
          path={selection.path}
          entry={selection.entry}
        />
      )}
    </>
  );
}

function ConfigSelectionHeader({path, children}: {path: string; children?: ReactNode}) {
  return (
    <PanelHeader className="flex-wrap gap-y-tight">
      <Code className="min-w-0 break-all text-foreground-neutral-base">{path}</Code>
      {children ? <div className="ml-auto flex items-center gap-cluster">{children}</div> : null}
    </PanelHeader>
  );
}

const VIEW_LABELS: Record<ConfigFileView, string> = {code: 'Code', history: 'History'};

/** Code and History are links, because the view lives in the URL. */
function FileViewToggle({
  workspaceSlug,
  projectSlug,
  path,
  view,
}: {
  workspaceSlug: string;
  projectSlug: string;
  path: string;
  view: ConfigFileView;
}) {
  return (
    <nav aria-label="File view" className="flex items-center gap-tight">
      {(['code', 'history'] as const).map((option) => {
        const isActive = option === view;
        return (
          <Button
            key={option}
            asChild
            size="xs"
            variant={isActive ? 'secondary' : 'transparentMuted'}
          >
            <ConfigFileLink
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              path={path}
              view={option}
            >
              {VIEW_LABELS[option]}
            </ConfigFileLink>
          </Button>
        );
      })}
    </nav>
  );
}

function ConfigFileCodeView({
  projectId,
  commit,
  path,
  entry,
}: {
  projectId: string;
  commit: string;
  path: string;
  entry: ConfigFileEntry;
}) {
  const entryProblem = configEntryProblem(entry);
  const fileQuery = useProjectConfigFileQuery({
    projectId,
    commit,
    path,
    enabled: entryProblem === null,
  });

  if (entryProblem) return <ConfigFileNotice problem={entryProblem} />;
  if (fileQuery.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading file"
        className="flex flex-1 flex-col gap-inline bg-background-contrast-base p-panel-compact"
      >
        <Skeleton className="h-16 w-1/3 rounded-4" />
        <Skeleton className="h-16 w-1/2 rounded-4" />
      </div>
    );
  }
  if (fileQuery.isError) {
    const problem = configReadProblem(
      fileQuery.error instanceof ApiError ? fileQuery.error.code : undefined,
    );
    if (problem !== 'read-failed') return <ConfigFileNotice problem={problem} />;
    return (
      <ConfigFileNotice
        problem={problem}
        onRetry={() => {
          void fileQuery.refetch();
        }}
      />
    );
  }
  return <ConfigFileCode path={path} content={fileQuery.data.content} />;
}

/** Mounted only when someone opens the view, so the history read waits for them. */
function ConfigHistoryView({
  projectId,
  commit,
  path,
}: {
  projectId: string;
  commit: string;
  path: string;
}) {
  const commitsQuery = useProjectConfigCommitsInfiniteQuery({projectId, commit, path});
  const commits = commitsQuery.data?.pages.flatMap((page) => page.commits) ?? [];

  return (
    <ConfigFileHistory
      path={path}
      commits={commits}
      isPending={commitsQuery.isPending}
      isError={commitsQuery.isError}
      hasNextPage={commitsQuery.hasNextPage}
      isFetchingNextPage={commitsQuery.isFetchingNextPage}
      isFetchNextPageError={commitsQuery.isFetchNextPageError}
      onRetry={() => {
        void commitsQuery.refetch();
      }}
      onLoadMore={() => {
        void commitsQuery.fetchNextPage();
      }}
    />
  );
}
