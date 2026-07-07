import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import {Tab, Tabs} from 'fumadocs-ui/components/tabs';
import {TypeTable} from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type {MDXComponents} from 'mdx/types';
import {MintImage, mintlifyComponents} from '@/mdx/mintlify';

// The MDX component seam: Fumadocs UI primitives, the Mintlify→Fumadocs compat
// shim (so ported source renders nearly verbatim), and the door to embedding
// @shipfox/react-ui components in docs pages.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...mintlifyComponents,
    img: MintImage,
    Tabs,
    Tab,
    TypeTable,
    pre: ({ref: _ref, ...props}) => (
      <CodeBlock {...props}>
        <Pre>{props.children}</Pre>
      </CodeBlock>
    ),
    ...components,
  };
}
