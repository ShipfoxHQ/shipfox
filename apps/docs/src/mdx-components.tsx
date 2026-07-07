import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import {ImageZoom} from 'fumadocs-ui/components/image-zoom';
import {Step, Steps} from 'fumadocs-ui/components/steps';
import {Tab, Tabs} from 'fumadocs-ui/components/tabs';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type {MDXComponents} from 'mdx/types';
import {RunnerLabelsSpecTable} from './app/components/runner-labels-spec-table';

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    // biome-ignore lint/suspicious/noExplicitAny: required by fuma-docs
    img: (props) => <ImageZoom {...(props as any)} />,
    RunnerLabelsSpecTable,
    Steps,
    Step,
    Tabs,
    Tab,
    pre: ({ref: _ref, ...props}) => (
      <CodeBlock {...props}>
        <Pre>{props.children}</Pre>
      </CodeBlock>
    ),
  };
}
