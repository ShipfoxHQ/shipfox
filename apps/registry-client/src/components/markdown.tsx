import {cn} from '@shipfox/react-ui/utils/cn';
import ReactMarkdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Package text comes from publishers, so a link only keeps an absolute http(s) URL or an anchor.
// A relative link would resolve against this site, not the package source.
const SAFE_HREF = /^(https?:\/\/|#)/i;

const components: Components = {
  // A README heading sits under the page's own section heading, so every level moves down one.
  h1: ({node: _node, ...props}) => <h3 className="text-lg font-medium" {...props} />,
  h2: ({node: _node, ...props}) => <h4 className="text-md font-medium" {...props} />,
  h3: ({node: _node, ...props}) => <h5 className="text-sm font-medium" {...props} />,
  h4: ({node: _node, ...props}) => <h6 className="text-sm font-medium" {...props} />,
  h5: ({node: _node, ...props}) => <h6 className="text-sm font-medium" {...props} />,
  h6: ({node: _node, ...props}) => <h6 className="text-sm font-medium" {...props} />,
  p: ({node: _node, ...props}) => <p className="text-sm leading-24" {...props} />,
  ul: ({node: _node, ...props}) => (
    <ul className="flex list-disc flex-col gap-tight pl-20 text-sm" {...props} />
  ),
  ol: ({node: _node, ...props}) => (
    <ol className="flex list-decimal flex-col gap-tight pl-20 text-sm" {...props} />
  ),
  blockquote: ({node: _node, ...props}) => (
    <blockquote
      className="border-l-2 border-border-neutral-strong pl-12 text-foreground-neutral-subtle"
      {...props}
    />
  ),
  a: ({node: _node, href, children, ...props}) =>
    href && SAFE_HREF.test(href) ? (
      <a
        href={href}
        rel="nofollow ugc noopener"
        className="text-foreground-highlight-interactive underline underline-offset-2"
        {...props}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  pre: ({node: _node, ...props}) => (
    <pre
      className="overflow-x-auto rounded-8 bg-background-contrast-base p-panel-compact font-code text-xs leading-20 text-foreground-contrast-primary [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit"
      {...props}
    />
  ),
  code: ({node: _node, ...props}) => (
    <code
      className="rounded-4 bg-background-components-base px-4 py-2 font-code text-[0.9em]"
      {...props}
    />
  ),
  table: ({node: _node, ...props}) => (
    <div className="overflow-x-auto">
      <table className="w-auto border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({node: _node, ...props}) => (
    <th className="border border-border-neutral-base px-8 py-4 text-left font-medium" {...props} />
  ),
  td: ({node: _node, ...props}) => (
    <td className="border border-border-neutral-base px-8 py-4" {...props} />
  ),
  hr: ({node: _node, ...props}) => <hr className="border-border-neutral-base" {...props} />,
};

/** Publisher Markdown: CommonMark with tables, without raw HTML or images. */
export function Markdown({children, className}: {children: string; className?: string}) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-cluster text-foreground-neutral-base', className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
