'use client';

import {
  type ComponentProps,
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Collapsible, CollapsibleContent} from '#components/collapsible/index.js';
import {Icon} from '#components/icon/index.js';
import {useControllableState} from '#hooks/useControllableState.js';
import {cn} from '#utils/cn.js';
import {findTypeaheadMatch} from './file-tree-typeahead.js';

const TREE_ITEM = '[role="treeitem"]';
const ROW = '[data-slot="file-tree-row"]';
const CHEVRON = '[data-slot="file-tree-chevron"]';
// A collapsing group stays mounted for its exit animation, but its nodes are gone.
const CLOSED_GROUP = '[role="group"][data-state="closed"]';

const TYPEAHEAD_WINDOW_MS = 300;
const ROW_INSET = 8;
const LEVEL_INDENT = 16;
const NO_PATHS: ReadonlySet<string> = new Set();
const NO_SEARCH = {query: '', typedAt: Number.NEGATIVE_INFINITY};

type FileTreeContextValue = {
  expandedPaths: ReadonlySet<string>;
  selectedPath: string | undefined;
  tabStopPath: string | undefined;
};

const FileTreeContext = createContext<FileTreeContextValue | undefined>(undefined);
const FileTreeLevelContext = createContext(1);

function useFileTree() {
  const context = useContext(FileTreeContext);
  if (!context) {
    throw new Error('FileTreeFolder and FileTreeFile must be used within a FileTree');
  }
  return context;
}

function getVisibleItems(tree: HTMLElement | null) {
  if (!tree) return [];
  return Array.from(tree.querySelectorAll<HTMLElement>(TREE_ITEM)).filter(
    (item) => !item.closest(CLOSED_GROUP),
  );
}

function getPath(item: HTMLElement) {
  return item.dataset.path ?? '';
}

function isFolder(item: HTMLElement) {
  return item.hasAttribute('aria-expanded');
}

function isOpenFolder(item: HTMLElement) {
  return item.getAttribute('aria-expanded') === 'true';
}

// AltGr types characters, but some layouts report it as Ctrl and Alt together.
function isShortcut(event: KeyboardEvent) {
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey;
  return hasModifier && !event.getModifierState('AltGraph');
}

function getParentItem(item: HTMLElement) {
  return item.parentElement?.closest<HTMLElement>(TREE_ITEM);
}

/** The node's path, then its ancestors' paths, nearest first. */
function getFocusTrail(item: HTMLElement) {
  const trail = [getPath(item)];
  for (let parent = getParentItem(item); parent; parent = getParentItem(parent)) {
    trail.push(getPath(parent));
  }
  return trail;
}

// A focused item holds its whole subtree, so the browser sees nothing to scroll when
// that subtree already fills the viewport. The row is what has to stay visible.
function focusItem(item: HTMLElement | null | undefined) {
  item?.focus({preventScroll: true});
}

type FileTreeLabelProps =
  | {'aria-label': string; 'aria-labelledby'?: never}
  | {'aria-label'?: never; 'aria-labelledby': string};

export type FileTreeProps = Omit<
  ComponentProps<'ul'>,
  | 'aria-label'
  | 'aria-labelledby'
  | 'onBlur'
  | 'onClick'
  | 'onFocus'
  | 'onKeyDown'
  | 'onSelect'
  | 'ref'
  | 'tabIndex'
> &
  FileTreeLabelProps & {
    expanded?: ReadonlySet<string>;
    defaultExpanded?: ReadonlySet<string>;
    onExpandedChange?: (expanded: ReadonlySet<string>) => void;
    selectedPath?: string | undefined;
    onSelect?: (path: string) => void;
  };

/**
 * A read-only file tree that acts as one tab stop. Tab enters on the last-focused
 * node, or on the selected node the first time, and arrow keys, Home, End, and
 * typeahead move inside it.
 *
 * Activating a node with a click, Enter, or Space selects it, and opens it if it's
 * a closed folder. Only the chevron and the Left arrow close a folder, so selecting
 * an open folder never hides its contents.
 *
 * If the focused node is hidden or removed, focus moves to the node with the same
 * path, then its nearest visible ancestor, then the selected node, then the first.
 */
export function FileTree({
  expanded,
  defaultExpanded,
  onExpandedChange,
  selectedPath,
  onSelect,
  className,
  children,
  ...props
}: FileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useControllableState(
    expanded,
    defaultExpanded ?? NO_PATHS,
    onExpandedChange,
  );
  const [tabStopPath, setTabStopPath] = useState(selectedPath);
  const treeRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef(NO_SEARCH);
  const focusTrailRef = useRef<string[]>([]);
  const hasFocusRef = useRef(false);

  const syncTabStop = useCallback(() => {
    const items = getVisibleItems(treeRef.current);
    const preferredItems = [...focusTrailRef.current, selectedPath].map((path) =>
      items.find((item) => getPath(item) === path),
    );
    const tabStop = preferredItems.find((item) => item !== undefined) ?? items[0];

    setTabStopPath(tabStop && getPath(tabStop));
    if (!tabStop) hasFocusRef.current = false;
    else if (hasFocusRef.current) focusItem(tabStop);
  }, [selectedPath]);

  // Rows can mount, unmount, or close without this component rendering, because a
  // child component or the collapsible's exit animation owns them. A tree with no
  // tab stop drops out of the keyboard order, and a removed focused node drops focus
  // to the page.
  useLayoutEffect(() => {
    syncTabStop();
    const tree = treeRef.current;
    if (!tree) return;

    const observer = new MutationObserver(syncTabStop);
    observer.observe(tree, {
      subtree: true,
      childList: true,
      attributeFilter: ['data-path', 'data-state'],
    });
    return () => observer.disconnect();
  }, [syncTabStop]);

  const contextValue = useMemo(
    () => ({expandedPaths, selectedPath, tabStopPath}),
    [expandedPaths, selectedPath, tabStopPath],
  );

  function setPathExpanded(path: string, isExpanded: boolean) {
    const nextExpanded = new Set(expandedPaths);
    if (isExpanded) nextExpanded.add(path);
    else nextExpanded.delete(path);
    setExpandedPaths(nextExpanded);
  }

  function activate(item: HTMLElement) {
    onSelect?.(getPath(item));
    if (isFolder(item) && !isOpenFolder(item)) setPathExpanded(getPath(item), true);
  }

  function openOrEnter(item: HTMLElement, nextItem: HTMLElement | undefined) {
    if (!isFolder(item)) return;
    if (!isOpenFolder(item)) setPathExpanded(getPath(item), true);
    else if (nextItem && item.contains(nextItem)) focusItem(nextItem);
  }

  function closeOrExit(item: HTMLElement) {
    if (isOpenFolder(item)) setPathExpanded(getPath(item), false);
    else focusItem(getParentItem(item));
  }

  function isTypeaheadKey(key: string) {
    // A space only searches once a search is running. Otherwise it activates the node.
    if (key === ' ') return Date.now() - typeaheadRef.current.typedAt < TYPEAHEAD_WINDOW_MS;
    return key.length === 1;
  }

  function focusTypeaheadMatch(key: string, items: HTMLElement[], from: number) {
    const {query, typedAt} = typeaheadRef.current;
    const now = Date.now();
    const isContinuing = now - typedAt < TYPEAHEAD_WINDOW_MS;
    const nextQuery = isContinuing ? query + key : key;
    typeaheadRef.current = {query: nextQuery, typedAt: now};

    const names = items.map((item) => item.dataset.name ?? '');
    const match = findTypeaheadMatch({names, from, query: nextQuery});
    if (match !== undefined) focusItem(items[match]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const item = (event.target as Element).closest<HTMLElement>(TREE_ITEM);
    if (!item || isShortcut(event)) return;

    const items = getVisibleItems(event.currentTarget);
    const index = items.indexOf(item);
    const nextItem = items[index + 1];

    if (isTypeaheadKey(event.key)) {
      focusTypeaheadMatch(event.key, items, index);
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        focusItem(nextItem);
        break;
      case 'ArrowUp':
        focusItem(items[index - 1]);
        break;
      case 'Home':
        focusItem(items[0]);
        break;
      case 'End':
        focusItem(items.at(-1));
        break;
      case 'ArrowRight':
        openOrEnter(item, nextItem);
        break;
      case 'ArrowLeft':
        closeOrExit(item);
        break;
      case 'Enter':
      case ' ':
        activate(item);
        break;
      default:
        return;
    }
    typeaheadRef.current = NO_SEARCH;
    event.preventDefault();
  }

  function handleClick(event: MouseEvent<HTMLUListElement>) {
    const target = event.target as Element;
    const item = target.closest<HTMLElement>(TREE_ITEM);
    if (!item) return;

    if (target.closest(CHEVRON)) setPathExpanded(getPath(item), !isOpenFolder(item));
    else activate(item);
  }

  function handleFocus(event: FocusEvent<HTMLUListElement>) {
    const item = event.target.closest<HTMLElement>(TREE_ITEM);
    if (!item) return;

    hasFocusRef.current = true;
    focusTrailRef.current = getFocusTrail(item);
    setTabStopPath(getPath(item));
    // jsdom has no scrollIntoView, and consumers run this component under it.
    item.querySelector(ROW)?.scrollIntoView?.({block: 'nearest'});
  }

  function handleBlur() {
    hasFocusRef.current = false;
  }

  return (
    <FileTreeContext.Provider value={contextValue}>
      <ul
        {...props}
        ref={treeRef}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: GitHub and Primer build a tree on nested lists, which also keeps forced-colors heuristics working.
        role="tree"
        data-slot="file-tree"
        className={cn('list-none', className)}
        onBlur={handleBlur}
        onClick={handleClick}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      >
        {children}
      </ul>
    </FileTreeContext.Provider>
  );
}

type FileTreeRowProps = Omit<ComponentProps<'div'>, 'children'>;

type FileTreeItemProps = Omit<ComponentProps<'li'>, 'children'> & {
  path: string;
  name: string;
  icon: ReactNode;
  isExpanded?: boolean;
  rowProps: FileTreeRowProps;
  children?: ReactNode;
};

function FileTreeItem({
  path,
  name,
  icon,
  isExpanded,
  rowProps: {className, style, ...rowProps},
  children,
  ...props
}: FileTreeItemProps) {
  const {selectedPath, tabStopPath} = useFileTree();
  const level = useContext(FileTreeLevelContext);
  const labelId = useId();
  const isSelected = selectedPath === path;
  const hasChevron = isExpanded !== undefined;

  return (
    <li
      {...props}
      role="treeitem"
      // VoiceOver ignores a treeitem's text content, so its name has to be referenced.
      aria-labelledby={labelId}
      aria-level={level}
      aria-expanded={isExpanded}
      aria-selected={isSelected}
      aria-current={isSelected ? 'true' : undefined}
      tabIndex={tabStopPath === path ? 0 : -1}
      data-slot="file-tree-item"
      data-path={path}
      data-name={name}
      className={cn(
        // The item holds its whole subtree, so the ring belongs on its own row. Inset,
        // because a collapsible group clips anything outside its bounds. Forced colors
        // drop shadows but repaint a transparent outline.
        'outline-none [&:focus-visible>[data-slot=file-tree-row]]:shadow-focus-inset',
        '[&:focus-visible>[data-slot=file-tree-row]]:outline-2',
        '[&:focus-visible>[data-slot=file-tree-row]]:-outline-offset-2',
        '[&:focus-visible>[data-slot=file-tree-row]]:outline-transparent',
      )}
    >
      <div
        {...rowProps}
        data-slot="file-tree-row"
        style={{...style, paddingInlineStart: ROW_INSET + (level - 1) * LEVEL_INDENT}}
        className={cn(
          'flex min-h-28 cursor-pointer select-none items-start gap-4 py-4 pe-8',
          'text-sm leading-20 text-foreground-neutral-base transition-colors',
          'hover:bg-background-neutral-hover',
          isSelected && 'bg-background-neutral-pressed hover:bg-background-neutral-pressed',
          // Forced colors drop the neutral fill, which would leave selection invisible.
          // Opting out also removes the canvas backplate, which hides HighlightText.
          isSelected &&
            'forced-colors:forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:hover:bg-[Highlight]',
          isSelected &&
            'forced-colors:text-[HighlightText] forced-colors:[&_svg]:text-[HighlightText]',
          className,
        )}
      >
        <span aria-hidden="true" className="flex h-20 shrink-0 items-center gap-4">
          {hasChevron ? (
            <Icon
              name="chevronRight"
              data-slot="file-tree-chevron"
              className={cn(
                'size-16 text-foreground-neutral-muted motion-safe:transition-transform',
                isExpanded && 'rotate-90',
              )}
            />
          ) : (
            <span className="size-16" />
          )}
          <span className="flex text-foreground-neutral-muted [&>svg]:size-16">{icon}</span>
        </span>
        <span id={labelId} className="min-w-0 font-code wrap-anywhere">
          {name}
        </span>
      </div>
      {hasChevron && (
        <CollapsibleContent asChild>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset can't be a tree group, which has to own treeitem children. */}
          <ul role="group" aria-labelledby={labelId} className="list-none">
            <FileTreeLevelContext.Provider value={level + 1}>
              {children}
            </FileTreeLevelContext.Provider>
          </ul>
        </CollapsibleContent>
      )}
    </li>
  );
}

type FileTreeNodeProps = FileTreeRowProps & {
  path: string;
  name: string;
  icon?: ReactNode;
};

export type FileTreeFolderProps = FileTreeNodeProps & {
  children?: ReactNode;
};

/** Extra props go on the row, so they don't reach the folder's contents. */
export function FileTreeFolder({path, name, icon, children, ...rowProps}: FileTreeFolderProps) {
  const {expandedPaths} = useFileTree();
  const isExpanded = expandedPaths.has(path);

  return (
    <Collapsible asChild open={isExpanded}>
      <FileTreeItem
        path={path}
        name={name}
        icon={icon ?? <Icon name="folderLine" />}
        isExpanded={isExpanded}
        rowProps={rowProps}
      >
        {children}
      </FileTreeItem>
    </Collapsible>
  );
}

export type FileTreeFileProps = FileTreeNodeProps;

/** Extra props go on the row, matching `FileTreeFolder`. */
export function FileTreeFile({path, name, icon, ...rowProps}: FileTreeFileProps) {
  return (
    <FileTreeItem
      path={path}
      name={name}
      icon={icon ?? <Icon name="fileCodeLine" />}
      rowProps={rowProps}
    />
  );
}
