import {Accordion, Accordions} from 'fumadocs-ui/components/accordion';
import {Callout} from 'fumadocs-ui/components/callout';
import {Card, Cards} from 'fumadocs-ui/components/card';
import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import {ImageZoom} from 'fumadocs-ui/components/image-zoom';
import {Step, Steps} from 'fumadocs-ui/components/steps';
import {Tab, Tabs} from 'fumadocs-ui/components/tabs';
import {TypeTable} from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type {MDXComponents} from 'mdx/types';
import type {ComponentProps} from 'react';
import {basePath} from '@/url';

// Root-relative image sources stay clean `/img/...` in the MDX; the app is served
// under /docs, so prefix the basePath here and keep Fumadocs click-to-zoom.
function DocsImage({src, ...props}: ComponentProps<'img'>) {
  const resolved =
    typeof src === 'string' && src.startsWith('/') ? `${basePath}${src}` : (src ?? '');
  // biome-ignore lint/suspicious/noExplicitAny: bridge intrinsic img props to fumadocs ImageZoom
  return <ImageZoom src={resolved as any} {...(props as any)} />;
}

// The MDX seam: Fumadocs UI primitives plus the door to embedding
// @shipfox/react-ui components in docs pages.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Card,
    Cards,
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
