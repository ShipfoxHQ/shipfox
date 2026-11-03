import {FileTree, FileTreeFile, FileTreeFolder} from '@shipfox/react-ui/file-tree';
import {Icon} from '@shipfox/react-ui/icon';
import type {ConfigTreeFile, ConfigTreeFolder} from '#core/config-files.js';

export interface ConfigFileTreeProps {
  root: ConfigTreeFolder;
  expanded: ReadonlySet<string>;
  onExpandedChange: (expanded: ReadonlySet<string>) => void;
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}

export function ConfigFileTree({
  root,
  expanded,
  onExpandedChange,
  selectedPath,
  onSelect,
}: ConfigFileTreeProps) {
  return (
    <FileTree
      aria-label="Config files"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      selectedPath={selectedPath}
      onSelect={onSelect}
      className="py-tight"
    >
      <ConfigTreeFolderNode folder={root} />
    </FileTree>
  );
}

function ConfigTreeFolderNode({folder}: {folder: ConfigTreeFolder}) {
  return (
    <FileTreeFolder path={folder.path} name={folder.name}>
      {folder.children.map((node) =>
        node.kind === 'folder' ? (
          <ConfigTreeFolderNode key={node.path} folder={node} />
        ) : (
          <ConfigTreeFileNode key={node.path} file={node} />
        ),
      )}
    </FileTreeFolder>
  );
}

function ConfigTreeFileNode({file}: {file: ConfigTreeFile}) {
  if (file.entry.type === 'symlink') {
    return <FileTreeFile path={file.path} name={file.name} icon={<Icon name="linksLine" />} />;
  }
  if (file.entry.type === 'submodule') {
    return (
      <FileTreeFile path={file.path} name={file.name} icon={<Icon name="gitRepositoryLine" />} />
    );
  }
  return <FileTreeFile path={file.path} name={file.name} />;
}
