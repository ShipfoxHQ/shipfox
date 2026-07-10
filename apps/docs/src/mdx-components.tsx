import {Accordion, Accordions} from 'fumadocs-ui/components/accordion';
import {Callout} from 'fumadocs-ui/components/callout';
import {Card, Cards} from 'fumadocs-ui/components/card';
import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import {Step, Steps} from 'fumadocs-ui/components/steps';
import {Tab, Tabs} from 'fumadocs-ui/components/tabs';
import {TypeTable} from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type {MDXComponents} from 'mdx/types';
import {DocsImage} from '@/app/components/docs-image';
import {DocsVideo} from '@/app/components/docs-video';

// The MDX seam: Fumadocs UI primitives plus the door to embedding
// @shipfox/react-ui components in docs pages.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Card,
    Cards,
    DocsImage,
    DocsVideo,
    Callout,
    Steps,
    Step,
    Tabs,
    Tab,
    Accordions,
    Accordion,
    TypeTable,
    img: DocsImage,
    pre: ({ref: _ref, ...props}) => (
      <CodeBlock {...props}>
        <Pre>{props.children}</Pre>
      </CodeBlock>
    ),
    ...components,
  };
}
