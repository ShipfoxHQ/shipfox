import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {expect, userEvent, within} from 'storybook/test';
import {Icon} from '#components/icon/index.js';
import {Panel} from '#components/panel/index.js';
import {FileTree, FileTreeFile, FileTreeFolder} from './file-tree.js';

const meta = {
  title: 'Components/FileTree',
  component: FileTree,
  tags: ['autodocs'],
  args: {'aria-label': 'Config files'},
  parameters: {
    docs: {
      description: {
        component:
          'A read-only file tree that acts as one tab stop, using a roving tabindex. Arrow keys, Home, End, and typeahead move inside it, and returning to it restores the last-focused node. `FileTree` needs an `aria-label` or `aria-labelledby`. Activating a node selects it and opens a closed folder; only the chevron and the Left arrow close a folder. The tree has no surface of its own, so place it in a `Panel`.',
      },
    },
  },
} satisfies Meta<typeof FileTree>;

export default meta;

type Story = StoryObj<typeof meta>;

const WORKFLOWS = '.shipfox/workflows';
const IMPLEMENT = `${WORKFLOWS}/implement.yml`;

function ConfigFiles() {
  return (
    <FileTreeFolder path=".shipfox" name=".shipfox">
      <FileTreeFolder path=".shipfox/actions" name="actions">
        <FileTreeFile path=".shipfox/actions/deploy.ts" name="deploy.ts" />
      </FileTreeFolder>
      <FileTreeFolder path=".shipfox/agents" name="agents">
        <FileTreeFile path=".shipfox/agents/shippy.yaml" name="shippy.yaml" />
      </FileTreeFolder>
      <FileTreeFolder path=".shipfox/prompts" name="prompts">
        <FileTreeFile path=".shipfox/prompts/implement.md" name="implement.md" />
      </FileTreeFolder>
      <FileTreeFolder path={WORKFLOWS} name="workflows">
        <FileTreeFile path={`${WORKFLOWS}/ask-codebase.yml`} name="ask-codebase.yml" />
        <FileTreeFile path={IMPLEMENT} name="implement.yml" />
        <FileTreeFile
          path={`${WORKFLOWS}/review-pull-requests.yml`}
          name="review-pull-requests.yml"
        />
      </FileTreeFolder>
    </FileTreeFolder>
  );
}

function TreePanel({children}: {children: React.ReactNode}) {
  return <Panel className="w-[320px] overflow-hidden">{children}</Panel>;
}

const DEFAULT_EXPANDED = ['.shipfox', '.shipfox/agents', WORKFLOWS];

export const Playground: Story = {
  render: () => {
    const [selectedPath, setSelectedPath] = useState(IMPLEMENT);
    return (
      <TreePanel>
        <FileTree
          aria-label="Config files"
          defaultExpanded={new Set(DEFAULT_EXPANDED)}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
        >
          <ConfigFiles />
        </FileTree>
      </TreePanel>
    );
  },
};

export const States: Story = {
  render: () => (
    <div className="flex items-start gap-24">
      <TreePanel>
        <FileTree aria-label="Closed folders" defaultExpanded={new Set(['.shipfox'])}>
          <ConfigFiles />
        </FileTree>
      </TreePanel>
      <TreePanel>
        <FileTree
          aria-label="Selected folder"
          defaultExpanded={new Set(['.shipfox'])}
          selectedPath=".shipfox"
        >
          <ConfigFiles />
        </FileTree>
      </TreePanel>
    </div>
  ),
};

export const LongNames: Story = {
  render: () => (
    <Panel className="w-[220px] overflow-hidden">
      <FileTree aria-label="Long names" defaultExpanded={new Set(['workflows'])}>
        <FileTreeFolder path="workflows" name="workflows">
          <FileTreeFile
            path="workflows/nightly-dependency-review-and-security-triage.yml"
            name="nightly-dependency-review-and-security-triage.yml"
          />
          <FileTreeFile path="workflows/short.yml" name="short.yml" />
        </FileTreeFolder>
      </FileTree>
    </Panel>
  ),
};

export const CustomIcons: Story = {
  render: () => (
    <TreePanel>
      <FileTree aria-label="Custom icons">
        <FileTreeFile path="README.md" name="README.md" icon={<Icon name="bookOpen" />} />
        <FileTreeFile path="logo.svg" name="logo.svg" icon={<Icon name="imageAdd" />} />
      </FileTree>
    </TreePanel>
  ),
};

export const TestKeyboardFocus: Story = {
  play: async () => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  },
  render: () => (
    <TreePanel>
      <FileTree
        aria-label="Config files"
        defaultExpanded={new Set(DEFAULT_EXPANDED)}
        selectedPath=".shipfox/actions"
      >
        <ConfigFiles />
      </FileTree>
    </TreePanel>
  ),
};

function isRowInView(item: HTMLElement, scroller: HTMLElement) {
  const row = item.querySelector('[data-slot="file-tree-row"]') as HTMLElement;
  const rowBounds = row.getBoundingClientRect();
  const scrollerBounds = scroller.getBoundingClientRect();
  return rowBounds.top >= scrollerBounds.top && rowBounds.bottom <= scrollerBounds.bottom;
}

// Runs here rather than in the unit tests, because jsdom has no layout. An open folder
// holds its subtree, so focusing it scrolls nothing once that subtree fills the view.
export const TestScrollsToOpenFolderRow: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const scroller = canvas.getByTestId('scroller');
    const root = canvas.getByRole('treeitem', {name: '.shipfox'});
    await userEvent.tab();

    await userEvent.keyboard('{End}{Home}');
    await expect(isRowInView(root, scroller)).toBe(true);

    scroller.scrollTop = scroller.scrollHeight;
    await userEvent.tab();
    await userEvent.tab({shift: true});
    await expect(document.activeElement).toBe(root);
    await expect(isRowInView(root, scroller)).toBe(true);

    // The next open folder sits just below the view, so the row should move one step.
    await userEvent.keyboard('{Home}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    const row = canvas.getByRole('treeitem', {name: 'prompts'});
    await expect(isRowInView(row, scroller)).toBe(true);
    await userEvent.keyboard('{ArrowDown}');
    const folder = canvas.getByRole('treeitem', {name: 'workflows'});
    const folderRow = folder.querySelector('[data-slot="file-tree-row"]') as HTMLElement;
    const distanceToBottom =
      scroller.getBoundingClientRect().bottom - folderRow.getBoundingClientRect().bottom;
    await expect(Math.abs(distanceToBottom)).toBeLessThan(2);
  },
  render: () => (
    <div className="flex w-[320px] flex-col gap-8">
      <Panel data-testid="scroller" className="h-[112px] overflow-auto">
        <FileTree aria-label="Config files" defaultExpanded={new Set(DEFAULT_EXPANDED)}>
          <ConfigFiles />
        </FileTree>
      </Panel>
      <button type="button">After</button>
    </div>
  ),
};

function CollapseFromOutside() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(['workflows']));
  return (
    <div className="flex flex-col gap-8">
      <TreePanel>
        <FileTree aria-label="Config files" expanded={expanded} onExpandedChange={setExpanded}>
          <FileTreeFolder path="workflows" name="workflows">
            <FileTreeFile path="workflows/implement.yml" name="implement.yml" />
          </FileTreeFolder>
        </FileTree>
      </TreePanel>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setExpanded(new Set())}
      >
        Collapse
      </button>
    </div>
  );
}

// Runs here for the same reason as `TestCollapsingFolder`: the focused node is still
// mounted while its group animates closed.
export const TestFocusedNodeCollapsedFromOutside: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await expect(document.activeElement).toBe(
      canvas.getByRole('treeitem', {name: 'implement.yml'}),
    );

    const group = canvas.getByRole('group', {name: 'workflows'});

    await userEvent.click(canvas.getByRole('button', {name: 'Collapse'}));

    await expect(group.isConnected).toBe(true);
    await expect(document.activeElement).toBe(canvas.getByRole('treeitem', {name: 'workflows'}));
  },
  render: () => <CollapseFromOutside />,
};

// Runs here rather than in the unit tests, because jsdom has no exit animation to
// keep a closing group mounted.
export const TestCollapsingFolder: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.tab();

    await userEvent.keyboard('{ArrowLeft}{ArrowDown}');

    await expect(document.activeElement).toBe(canvas.getByRole('treeitem', {name: 'README.md'}));
    await userEvent.keyboard('{ArrowUp}');
    await expect(document.activeElement).toBe(canvas.getByRole('treeitem', {name: 'workflows'}));
  },
  render: () => (
    <TreePanel>
      <FileTree aria-label="Config files" defaultExpanded={new Set(['workflows'])}>
        <FileTreeFolder path="workflows" name="workflows">
          <FileTreeFile path="workflows/implement.yml" name="implement.yml" />
        </FileTreeFolder>
        <FileTreeFile path="README.md" name="README.md" />
      </FileTree>
    </TreePanel>
  ),
};
