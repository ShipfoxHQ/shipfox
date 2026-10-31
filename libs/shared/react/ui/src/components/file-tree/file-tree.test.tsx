import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Profiler, useEffect, useState} from 'react';
import {FileTree, FileTreeFile, FileTreeFolder, type FileTreeProps} from './file-tree.js';

const TYPEAHEAD_WINDOW_MS = 300;

const ALL_FOLDERS = ['.shipfox', '.shipfox/agents', '.shipfox/workflows'];

type TreeOptions = Omit<FileTreeProps, 'aria-label' | 'aria-labelledby'>;

function ConfigTree(props: TreeOptions) {
  return (
    <FileTree aria-label="Config files" {...props}>
      <FileTreeFolder path=".shipfox" name=".shipfox">
        <FileTreeFolder path=".shipfox/agents" name="agents">
          <FileTreeFile path=".shipfox/agents/shippy.yaml" name="shippy.yaml" />
        </FileTreeFolder>
        <FileTreeFolder path=".shipfox/workflows" name="workflows">
          <FileTreeFile path=".shipfox/workflows/implement.yml" name="implement.yml" />
          <FileTreeFile path=".shipfox/workflows/review.yml" name="review.yml" />
          <FileTreeFile path=".shipfox/workflows/runbook.yml" name="runbook.yml" />
        </FileTreeFolder>
      </FileTreeFolder>
      <FileTreeFile path="README.md" name="README.md" />
    </FileTree>
  );
}

function renderTree(props: TreeOptions = {}) {
  const user = userEvent.setup();
  render(
    <>
      <button type="button">Before</button>
      <ConfigTree defaultExpanded={new Set(ALL_FOLDERS)} {...props} />
      <button type="button">After</button>
    </>,
  );
  return user;
}

function item(name: string) {
  return screen.getByRole('treeitem', {name});
}

function tabStops() {
  return screen.getAllByRole('treeitem').filter((node) => node.tabIndex === 0);
}

async function focusNode(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.tab();
  item(name).focus();
}

function CollapseButton({onCollapse}: {onCollapse: () => void}) {
  // Keeps focus where it was, so the tree is what loses its focused node.
  return (
    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCollapse}>
      Collapse
    </button>
  );
}

describe('FileTree', () => {
  describe('structure', () => {
    test('exposes a labelled tree of nested groups', () => {
      renderTree();

      const tree = screen.getByRole('tree', {name: 'Config files'});
      const group = screen.getByRole('group', {name: 'workflows'});

      expect(tree.tagName).toBe('UL');
      expect(group.tagName).toBe('UL');
      expect(item('review.yml').closest('[role="group"]')).toBe(group);
    });

    test('references each node name from its visible label', () => {
      renderTree();

      const labelId = item('workflows').getAttribute('aria-labelledby') ?? '';

      expect(document.getElementById(labelId)?.textContent).toBe('workflows');
    });

    test('sets each node level from its nesting', () => {
      renderTree();

      expect(item('.shipfox').getAttribute('aria-level')).toBe('1');
      expect(item('workflows').getAttribute('aria-level')).toBe('2');
      expect(item('review.yml').getAttribute('aria-level')).toBe('3');
    });

    test('marks expansion on folders only', () => {
      renderTree({defaultExpanded: new Set(['.shipfox'])});

      expect(item('.shipfox').getAttribute('aria-expanded')).toBe('true');
      expect(item('agents').getAttribute('aria-expanded')).toBe('false');
      expect(item('README.md').hasAttribute('aria-expanded')).toBe(false);
    });

    test('does not render the contents of a closed folder', () => {
      renderTree({defaultExpanded: new Set(['.shipfox'])});

      expect(screen.queryByRole('treeitem', {name: 'review.yml'})).toBeNull();
    });

    test('hides icons from assistive technology', () => {
      renderTree();

      const icons = item('README.md').querySelectorAll('svg');

      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
      }
    });

    test('marks only the selected node as selected and current', () => {
      renderTree({selectedPath: '.shipfox/workflows/review.yml'});

      expect(item('review.yml').getAttribute('aria-selected')).toBe('true');
      expect(item('review.yml').getAttribute('aria-current')).toBe('true');
      expect(item('implement.yml').getAttribute('aria-selected')).toBe('false');
      expect(item('implement.yml').hasAttribute('aria-current')).toBe(false);
    });

    test('throws when a node renders outside a tree', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      expect(() => render(<FileTreeFile path="a" name="a" />)).toThrow(
        'must be used within a FileTree',
      );

      consoleError.mockRestore();
    });
  });

  describe('tab stop', () => {
    test('keeps exactly one node in the tab order', () => {
      renderTree();

      expect(tabStops()).toHaveLength(1);
    });

    test('tabs through the tree as one stop', async () => {
      const user = renderTree();

      await user.tab();
      await user.tab();
      await user.tab();

      expect(document.activeElement).toBe(screen.getByRole('button', {name: 'After'}));
    });

    test('enters on the first node by default', async () => {
      const user = renderTree();

      await user.tab();
      await user.tab();

      expect(document.activeElement).toBe(item('.shipfox'));
    });

    test('enters on the selected node the first time', async () => {
      const user = renderTree({selectedPath: '.shipfox/workflows/review.yml'});

      await user.tab();
      await user.tab();

      expect(document.activeElement).toBe(item('review.yml'));
    });

    test('falls back to the first node when the selected node is hidden', () => {
      renderTree({defaultExpanded: new Set(), selectedPath: '.shipfox/workflows/review.yml'});

      expect(tabStops()).toEqual([item('.shipfox')]);
    });

    test('restores the last-focused node on return', async () => {
      const user = renderTree({selectedPath: 'README.md'});

      await user.tab();
      await user.tab();
      await user.keyboard('{ArrowUp}{ArrowUp}');
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', {name: 'After'}));
      await user.tab({shift: true});

      expect(document.activeElement).toBe(item('review.yml'));
    });

    test('restores the last-focused node over a later selection', async () => {
      function Selectable() {
        const [selectedPath, setSelectedPath] = useState<string>();
        return (
          <>
            <button type="button" onClick={() => setSelectedPath('README.md')}>
              Select
            </button>
            <ConfigTree defaultExpanded={new Set(ALL_FOLDERS)} selectedPath={selectedPath} />
          </>
        );
      }
      const user = userEvent.setup();
      render(<Selectable />);

      await user.tab();
      await user.tab();
      await user.keyboard('{ArrowDown}');
      await user.click(screen.getByRole('button', {name: 'Select'}));

      expect(tabStops()).toEqual([item('agents')]);
    });

    test('moves the tab stop off a node hidden by a controlled collapse', async () => {
      function Controlled() {
        const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(ALL_FOLDERS));
        return (
          <>
            <button type="button" onClick={() => setExpanded(new Set())}>
              Collapse all
            </button>
            <ConfigTree expanded={expanded} />
          </>
        );
      }
      const user = userEvent.setup();
      render(<Controlled />);

      await user.tab();
      await user.tab();
      await user.keyboard('{End}{ArrowUp}');
      expect(document.activeElement).toBe(item('runbook.yml'));
      await user.click(screen.getByRole('button', {name: 'Collapse all'}));

      expect(tabStops()).toEqual([item('.shipfox')]);
    });
  });

  describe('rows owned by a child component', () => {
    function LateRows() {
      const [rows, setRows] = useState<string[]>([]);
      useEffect(() => {
        void Promise.resolve().then(() => setRows(['one.yml', 'two.yml']));
      }, []);
      return rows.map((name) => <FileTreeFile key={name} path={name} name={name} />);
    }

    function RemovableRows() {
      const [rows, setRows] = useState(['one.yml', 'two.yml']);
      return (
        <>
          <CollapseButton onCollapse={() => setRows(['two.yml'])} />
          {rows.map((name) => (
            <FileTreeFile key={name} path={name} name={name} />
          ))}
        </>
      );
    }

    test('gives rows that load after the tree a tab stop', async () => {
      render(
        <FileTree aria-label="Files">
          <LateRows />
        </FileTree>,
      );

      await screen.findAllByRole('treeitem');

      await waitFor(() => expect(tabStops()).toEqual([item('one.yml')]));
    });

    test('moves the tab stop when a child component renames its row', async () => {
      function RenamedRow() {
        const [path, setPath] = useState('old.yml');
        return (
          <>
            <CollapseButton onCollapse={() => setPath('new.yml')} />
            <FileTreeFile path={path} name={path} />
          </>
        );
      }
      const user = userEvent.setup();
      render(
        <FileTree aria-label="Files">
          <RenamedRow />
        </FileTree>,
      );
      expect(tabStops()).toEqual([item('old.yml')]);

      await user.click(screen.getByRole('button', {name: 'Collapse'}));

      await waitFor(() => expect(tabStops()).toEqual([item('new.yml')]));
    });

    test('moves focus when a child component removes the focused row', async () => {
      const user = userEvent.setup();
      render(
        <FileTree aria-label="Files">
          <RemovableRows />
        </FileTree>,
      );
      await user.tab();
      await user.tab();
      expect(document.activeElement).toBe(item('one.yml'));

      await user.click(screen.getByRole('button', {name: 'Collapse'}));

      await waitFor(() => expect(document.activeElement).toBe(item('two.yml')));
      expect(tabStops()).toEqual([item('two.yml')]);
    });
  });

  describe('focus recovery', () => {
    function ControlledTree({next, ...props}: {next: ReadonlySet<string>} & TreeOptions) {
      const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(ALL_FOLDERS));
      return (
        <>
          <CollapseButton onCollapse={() => setExpanded(next)} />
          <button type="button">Elsewhere</button>
          <ConfigTree {...props} expanded={expanded} />
        </>
      );
    }

    test('moves focus to the nearest visible ancestor when a collapse hides it', async () => {
      const user = userEvent.setup();
      render(<ControlledTree next={new Set(['.shipfox'])} />);
      await focusNode(user, 'review.yml');

      await user.click(screen.getByRole('button', {name: 'Collapse'}));

      await waitFor(() => expect(document.activeElement).toBe(item('workflows')));
      expect(tabStops()).toEqual([item('workflows')]);
    });

    test('skips ancestors that the same collapse hid', async () => {
      const user = userEvent.setup();
      render(<ControlledTree next={new Set()} />);
      await focusNode(user, 'review.yml');

      await user.click(screen.getByRole('button', {name: 'Collapse'}));

      await waitFor(() => expect(document.activeElement).toBe(item('.shipfox')));
    });

    test('leaves focus alone when it is outside the tree', async () => {
      const user = userEvent.setup();
      render(<ControlledTree next={new Set()} />);
      await focusNode(user, 'review.yml');
      screen.getByRole('button', {name: 'Elsewhere'}).focus();

      await user.click(screen.getByRole('button', {name: 'Collapse'}));

      await waitFor(() => expect(tabStops()).toEqual([item('.shipfox')]));
      expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Elsewhere'}));
    });

    test('keeps focus on a path whose row is replaced', async () => {
      function Remounting() {
        const [version, setVersion] = useState(0);
        return (
          <>
            <CollapseButton onCollapse={() => setVersion(1)} />
            <FileTree aria-label="Files">
              <FileTreeFile path="first" name="first" />
              <FileTreeFile key={version} path="second" name="second" />
            </FileTree>
          </>
        );
      }
      const user = userEvent.setup();
      render(<Remounting />);
      await focusNode(user, 'second');
      const original = item('second');

      await user.click(screen.getByRole('button', {name: 'Collapse'}));

      await waitFor(() => expect(item('second')).not.toBe(original));
      await waitFor(() => expect(document.activeElement).toBe(item('second')));
    });

    test('does not take focus back after the tree empties', async () => {
      function Refilling() {
        const [rows, setRows] = useState(['one.yml']);
        return (
          <>
            <CollapseButton
              onCollapse={() => setRows((current) => (current.length ? [] : ['one.yml']))}
            />
            <FileTree aria-label="Files">
              {rows.map((name) => (
                <FileTreeFile key={name} path={name} name={name} />
              ))}
            </FileTree>
          </>
        );
      }
      const user = userEvent.setup();
      render(<Refilling />);
      await focusNode(user, 'one.yml');
      const collapse = screen.getByRole('button', {name: 'Collapse'});

      await user.click(collapse);
      await waitFor(() => expect(screen.queryByRole('treeitem')).toBeNull());
      await user.click(collapse);

      await waitFor(() => expect(tabStops()).toEqual([item('one.yml')]));
      expect(document.activeElement).not.toBe(item('one.yml'));
    });
  });

  describe('scrolling', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    test('scrolls to the focused row rather than its whole subtree', async () => {
      const scrolled: Element[] = [];
      const options: unknown[] = [];
      Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element, arg) {
        scrolled.push(this);
        options.push(arg);
      };
      const user = renderTree();
      await focusNode(user, 'workflows');

      await user.keyboard('{Home}');

      expect(scrolled.at(-1)).toBe(item('.shipfox').querySelector('[data-slot="file-tree-row"]'));
      expect(options.at(-1)).toEqual({block: 'nearest'});
    });
  });

  describe('render cost', () => {
    test('commits once for each focus move', async () => {
      const onRender = vi.fn();
      const user = userEvent.setup();
      render(
        <Profiler id="tree" onRender={onRender}>
          <ConfigTree defaultExpanded={new Set(ALL_FOLDERS)} />
        </Profiler>,
      );
      await user.tab();
      onRender.mockClear();

      await user.keyboard('{ArrowDown}');

      expect(document.activeElement).toBe(item('agents'));
      expect(onRender).toHaveBeenCalledOnce();
    });
  });

  describe('keyboard', () => {
    test('ArrowDown moves to the next visible node without opening anything', async () => {
      const user = renderTree({defaultExpanded: new Set(['.shipfox'])});
      await focusNode(user, 'agents');

      await user.keyboard('{ArrowDown}');

      expect(document.activeElement).toBe(item('workflows'));
      expect(item('agents').getAttribute('aria-expanded')).toBe('false');
    });

    test('ArrowDown does nothing on the last node', async () => {
      const user = renderTree();
      await focusNode(user, 'README.md');

      await user.keyboard('{ArrowDown}');

      expect(document.activeElement).toBe(item('README.md'));
    });

    test('ArrowUp moves to the previous visible node', async () => {
      const user = renderTree();
      await focusNode(user, 'workflows');

      await user.keyboard('{ArrowUp}');

      expect(document.activeElement).toBe(item('shippy.yaml'));
    });

    test('ArrowUp does nothing on the first node', async () => {
      const user = renderTree();
      await focusNode(user, '.shipfox');

      await user.keyboard('{ArrowUp}');

      expect(document.activeElement).toBe(item('.shipfox'));
    });

    test('ArrowRight opens a closed folder and keeps focus', async () => {
      const user = renderTree({defaultExpanded: new Set(['.shipfox'])});
      await focusNode(user, 'workflows');

      await user.keyboard('{ArrowRight}');

      expect(item('workflows').getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(item('workflows'));
    });

    test('ArrowRight on an open folder moves to its first child', async () => {
      const user = renderTree();
      await focusNode(user, 'workflows');

      await user.keyboard('{ArrowRight}');

      expect(document.activeElement).toBe(item('implement.yml'));
    });

    test('ArrowRight on an open empty folder does not leave it', async () => {
      const user = userEvent.setup();
      render(
        <FileTree aria-label="Files" defaultExpanded={new Set(['empty'])}>
          <FileTreeFolder path="empty" name="empty" />
          <FileTreeFile path="next" name="next" />
        </FileTree>,
      );
      await user.tab();

      await user.keyboard('{ArrowRight}');

      expect(document.activeElement).toBe(item('empty'));
    });

    test('ArrowRight does nothing on a file', async () => {
      const user = renderTree();
      await focusNode(user, 'review.yml');

      await user.keyboard('{ArrowRight}');

      expect(document.activeElement).toBe(item('review.yml'));
    });

    test('ArrowLeft closes an open folder and keeps focus', async () => {
      const user = renderTree();
      await focusNode(user, 'workflows');

      await user.keyboard('{ArrowLeft}');

      expect(item('workflows').getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(item('workflows'));
    });

    test('ArrowLeft on a closed folder moves to its parent', async () => {
      const user = renderTree({defaultExpanded: new Set(['.shipfox'])});
      await focusNode(user, 'workflows');

      await user.keyboard('{ArrowLeft}');

      expect(document.activeElement).toBe(item('.shipfox'));
    });

    test('ArrowLeft on a file moves to its parent', async () => {
      const user = renderTree();
      await focusNode(user, 'review.yml');

      await user.keyboard('{ArrowLeft}');

      expect(document.activeElement).toBe(item('workflows'));
    });

    test('ArrowLeft does nothing on a root file', async () => {
      const user = renderTree();
      await focusNode(user, 'README.md');

      await user.keyboard('{ArrowLeft}');

      expect(document.activeElement).toBe(item('README.md'));
    });

    test('Home and End move to the first and last visible nodes', async () => {
      const user = renderTree({defaultExpanded: new Set(['.shipfox'])});
      await focusNode(user, 'agents');

      await user.keyboard('{End}');
      expect(document.activeElement).toBe(item('README.md'));

      await user.keyboard('{Home}');
      expect(document.activeElement).toBe(item('.shipfox'));
    });

    test('End skips the contents of closed folders', async () => {
      const user = userEvent.setup();
      render(
        <FileTree aria-label="Files">
          <FileTreeFile path="first" name="first" />
          <FileTreeFolder path="closed" name="closed">
            <FileTreeFile path="closed/hidden" name="hidden" />
          </FileTreeFolder>
        </FileTree>,
      );
      await user.tab();

      await user.keyboard('{End}');

      expect(document.activeElement).toBe(item('closed'));
    });

    test.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
    ])('%s selects a file', async (_label, key) => {
      const onSelect = vi.fn();
      const user = renderTree({onSelect});
      await focusNode(user, 'review.yml');

      await user.keyboard(key);

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/workflows/review.yml');
    });

    test('Enter selects and opens a closed folder', async () => {
      const onSelect = vi.fn();
      const user = renderTree({defaultExpanded: new Set(['.shipfox']), onSelect});
      await focusNode(user, 'workflows');

      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/workflows');
      expect(item('workflows').getAttribute('aria-expanded')).toBe('true');
    });

    test('Enter selects an open folder and leaves it open', async () => {
      const onSelect = vi.fn();
      const user = renderTree({onSelect});
      await focusNode(user, 'workflows');

      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/workflows');
      expect(item('workflows').getAttribute('aria-expanded')).toBe('true');
    });

    test('moving focus does not change the selection', async () => {
      const onSelect = vi.fn();
      const user = renderTree({onSelect});
      await focusNode(user, '.shipfox');

      await user.keyboard('{ArrowDown}{End}{Home}');

      expect(onSelect).not.toHaveBeenCalled();
    });

    test('prevents the page from scrolling on navigation keys', async () => {
      const user = renderTree();
      await focusNode(user, 'workflows');
      const onKeyDown = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
      document.addEventListener('keydown', onKeyDown);

      await user.keyboard('{ArrowDown}{End}{Home} ');
      document.removeEventListener('keydown', onKeyDown);

      expect(onKeyDown.mock.results.map((result) => result.value)).toEqual([
        true,
        true,
        true,
        true,
      ]);
    });

    test('leaves browser shortcuts alone', async () => {
      const user = renderTree();
      await focusNode(user, 'workflows');

      await user.keyboard('{Control>}r{/Control}{Meta>}r{/Meta}{Alt>}r{/Alt}');

      expect(document.activeElement).toBe(item('workflows'));
    });
  });

  describe('typeahead', () => {
    beforeEach(() => {
      vi.useFakeTimers({toFake: ['Date']});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('moves to the next node starting with the typed character', async () => {
      const user = renderTree();
      await focusNode(user, '.shipfox');

      await user.keyboard('r');

      expect(document.activeElement).toBe(item('review.yml'));
    });

    test('accumulates characters typed in quick succession', async () => {
      const user = renderTree();
      await focusNode(user, '.shipfox');

      await user.keyboard('ru');

      expect(document.activeElement).toBe(item('runbook.yml'));
    });

    test('cycles through matches when a character repeats', async () => {
      const user = renderTree();
      await focusNode(user, '.shipfox');

      await user.keyboard('rrr');

      expect(document.activeElement).toBe(item('README.md'));
    });

    test('starts a new search after a pause', async () => {
      const user = renderTree();
      await focusNode(user, '.shipfox');

      await user.keyboard('r');
      vi.advanceTimersByTime(TYPEAHEAD_WINDOW_MS);
      await user.keyboard('i');

      expect(document.activeElement).toBe(item('implement.yml'));
    });

    test('a space extends a running search instead of activating', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(
        <FileTree aria-label="Files" onSelect={onSelect}>
          <FileTreeFile path="my-notes.md" name="my-notes.md" />
          <FileTreeFile path="my plan.md" name="my plan.md" />
        </FileTree>,
      );
      await user.tab();

      await user.keyboard('my p');

      expect(document.activeElement).toBe(item('my plan.md'));
      expect(onSelect).not.toHaveBeenCalled();
    });

    test('Space activates again once the search ends', async () => {
      const onSelect = vi.fn();
      const user = renderTree({onSelect});
      await focusNode(user, '.shipfox');

      await user.keyboard('r');
      vi.advanceTimersByTime(TYPEAHEAD_WINDOW_MS);
      await user.keyboard(' ');

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/workflows/review.yml');
    });

    test('wraps past the last node', async () => {
      const user = renderTree();
      await focusNode(user, 'README.md');

      await user.keyboard('a');

      expect(document.activeElement).toBe(item('agents'));
    });

    test('ignores the contents of closed folders', async () => {
      const user = renderTree({defaultExpanded: new Set(['.shipfox'])});
      await focusNode(user, '.shipfox');

      await user.keyboard('i');

      expect(document.activeElement).toBe(item('.shipfox'));
    });

    test('keeps focus when nothing matches', async () => {
      const user = renderTree();
      await focusNode(user, 'workflows');

      await user.keyboard('z');

      expect(document.activeElement).toBe(item('workflows'));
    });
  });

  describe('pointer', () => {
    test('selects a file on click and focuses it', async () => {
      const onSelect = vi.fn();
      const user = renderTree({onSelect});

      await user.click(screen.getByText('review.yml'));

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/workflows/review.yml');
      expect(document.activeElement).toBe(item('review.yml'));
      expect(tabStops()).toEqual([item('review.yml')]);
    });

    test('selects a nested node once, without activating its ancestors', async () => {
      const onSelect = vi.fn();
      const onExpandedChange = vi.fn();
      const user = renderTree({onSelect, onExpandedChange});

      await user.click(screen.getByText('agents'));

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/agents');
      expect(onExpandedChange).not.toHaveBeenCalled();
    });

    test('clicking a closed folder selects and opens it', async () => {
      const onSelect = vi.fn();
      const user = renderTree({defaultExpanded: new Set(['.shipfox']), onSelect});

      await user.click(screen.getByText('workflows'));

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/workflows');
      expect(item('workflows').getAttribute('aria-expanded')).toBe('true');
    });

    test('clicking an open folder selects it and leaves it open', async () => {
      const onSelect = vi.fn();
      const user = renderTree({onSelect});

      await user.click(screen.getByText('workflows'));

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('.shipfox/workflows');
      expect(item('workflows').getAttribute('aria-expanded')).toBe('true');
    });

    test('the chevron toggles a folder without selecting it', async () => {
      const onSelect = vi.fn();
      const user = renderTree({onSelect});
      const chevron = item('workflows').querySelector('[data-slot="file-tree-chevron"]');

      await user.click(chevron as Element);
      expect(item('workflows').getAttribute('aria-expanded')).toBe('false');

      await user.click(chevron as Element);
      expect(item('workflows').getAttribute('aria-expanded')).toBe('true');
      expect(onSelect).not.toHaveBeenCalled();
    });

    test('collapsing a folder from inside it moves the tab stop to the folder', async () => {
      const user = renderTree();
      await focusNode(user, 'review.yml');
      const chevron = item('workflows').querySelector('[data-slot="file-tree-chevron"]');

      await user.click(chevron as Element);

      expect(document.activeElement).toBe(item('workflows'));
      expect(tabStops()).toEqual([item('workflows')]);
    });
  });

  describe('node props', () => {
    test('applies folder props to the row, not to the folder contents', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(
        <FileTree aria-label="Files" defaultExpanded={new Set(['folder'])}>
          <FileTreeFolder path="folder" name="folder" className="custom" onClick={onClick}>
            <FileTreeFile path="folder/child" name="child" />
          </FileTreeFolder>
        </FileTree>,
      );
      const row = item('folder').querySelector('[data-slot="file-tree-row"]');

      await user.click(screen.getByText('child'));
      expect(onClick).not.toHaveBeenCalled();

      await user.click(screen.getByText('folder'));
      expect(onClick).toHaveBeenCalledOnce();
      expect(row?.classList.contains('custom')).toBe(true);
      expect(item('folder').classList.contains('custom')).toBe(false);
    });

    test('keeps the row indent when a caller passes a style', () => {
      render(
        <FileTree aria-label="Files">
          <FileTreeFile path="file" name="file" style={{color: 'red', paddingInlineStart: 0}} />
        </FileTree>,
      );

      const row = item('file').querySelector<HTMLElement>('[data-slot="file-tree-row"]');

      expect(row?.style.color).toBe('red');
      expect(row?.style.paddingInlineStart).toBe('8px');
    });
  });

  describe('state', () => {
    test('reports expansion changes in uncontrolled mode', async () => {
      const onExpandedChange = vi.fn();
      const user = renderTree({defaultExpanded: new Set(['.shipfox']), onExpandedChange});
      await focusNode(user, 'workflows');

      await user.keyboard('{ArrowRight}');

      expect(onExpandedChange).toHaveBeenCalledExactlyOnceWith(
        new Set(['.shipfox', '.shipfox/workflows']),
      );
    });

    test('leaves a controlled tree unchanged until its owner updates', async () => {
      const onExpandedChange = vi.fn();
      const user = userEvent.setup();
      render(<ConfigTree expanded={new Set(['.shipfox'])} onExpandedChange={onExpandedChange} />);
      await focusNode(user, 'workflows');

      await user.keyboard('{ArrowRight}');

      expect(onExpandedChange).toHaveBeenCalledOnce();
      expect(item('workflows').getAttribute('aria-expanded')).toBe('false');
    });
  });
});
