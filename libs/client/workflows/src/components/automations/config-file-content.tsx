import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockItem,
} from '@shipfox/react-ui/code-block';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import type {IconName} from '@shipfox/react-ui/icon';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {type ConfigFileProblem, configFileLanguage} from '#core/config-files.js';

const CONFIG_CODE_THEMES = {light: 'vitesse-dark', dark: 'vitesse-dark'};

/** A read-only file on the code surface, with line numbers and no wrap. */
export function ConfigFileCode({path, content}: {path: string; content: string}) {
  const language = configFileLanguage(path);

  return (
    <CodeBlock
      data={[{language: language ?? 'text', filename: path, code: content}]}
      className="flex flex-col rounded-none bg-background-contrast-base shadow-none"
    >
      <CodeBlockBody className="flex overflow-auto scrollbar">
        {(item) => (
          <CodeBlockItem
            value={item.filename}
            className={
              'px-0 pb-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-background-contrast-base [&_code]:!text-sm [&_code]:!text-foreground-contrast-primary [&_.line]:!text-sm [&_.line]:before:!text-sm [&_.line]:before:!text-foreground-contrast-secondary'
            }
          >
            <CodeBlockContent
              language={language ?? 'text'}
              themes={CONFIG_CODE_THEMES}
              syntaxHighlighting={language !== null}
            >
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}

const PROBLEM_COPY: Record<
  Exclude<ConfigFileProblem, 'read-failed'>,
  {icon: IconName; title: string; description: string}
> = {
  'too-large': {
    icon: 'fileWarningLine',
    title: 'File too large to show',
    description: 'Shipfox shows files up to 1 MB.',
  },
  'not-text': {
    icon: 'fileForbidLine',
    title: 'Not a text file',
    description: 'Shipfox shows UTF-8 text files only.',
  },
  symlink: {
    icon: 'linksLine',
    title: 'Symbolic link',
    description: "Shipfox doesn't follow symbolic links, so there is nothing to show.",
  },
  submodule: {
    icon: 'gitRepositoryLine',
    title: 'Submodule',
    description: "This path is a git submodule. Shipfox doesn't read submodules.",
  },
  'not-found': {
    icon: 'fileUnknowLine',
    title: 'File not found',
    description: "This file isn't on the default branch.",
  },
};

export type ConfigFileNoticeProps =
  | {problem: Exclude<ConfigFileProblem, 'read-failed'>}
  | {problem: 'read-failed'; onRetry: () => void};

/** Takes the file's place when it can't be shown as code. */
export function ConfigFileNotice(props: ConfigFileNoticeProps) {
  const {problem} = props;
  if (problem === 'read-failed') {
    return (
      <LoadErrorState
        title="Couldn't read this file"
        description="The repository didn't answer. Try again in a moment."
        onRetry={props.onRetry}
        retryLabel="Retry reading the file"
        variant="panel"
      />
    );
  }

  const copy = PROBLEM_COPY[problem];
  return (
    <EmptyState
      icon={copy.icon}
      title={copy.title}
      description={copy.description}
      variant="panel"
    />
  );
}
