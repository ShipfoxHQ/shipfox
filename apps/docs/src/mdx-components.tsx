import {Accordion, Accordions} from 'fumadocs-ui/components/accordion';
import {Callout} from 'fumadocs-ui/components/callout';
import {Cards} from 'fumadocs-ui/components/card';
import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import {Step, Steps} from 'fumadocs-ui/components/steps';
import {Tab, Tabs} from 'fumadocs-ui/components/tabs';
import {TypeTable} from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type {MDXComponents} from 'mdx/types';
import {AgentHandoff} from '@/app/components/agent-handoff';
import {DocsCard} from '@/app/components/docs-card';
import {DocsImage} from '@/app/components/docs-image';
import {DocsVideo} from '@/app/components/docs-video';
import {IntegrationCatalog as IntegrationCatalogClient} from '@/app/components/integration-catalog';
import {ModelCatalogTable} from '@/app/components/model-catalog';
import {TemplateDetail} from '@/app/components/template-catalog/template-detail';
import {TemplateGallery as TemplateGalleryClient} from '@/app/components/template-catalog/template-gallery';
import {getIntegrationCatalog} from '@/lib/integration-catalog-source';
import {getModelCatalog} from '@/lib/model-catalog-source';
import {getTemplateCatalog} from '@/lib/template-catalog/source';

// The MDX seam: Fumadocs UI primitives plus the door to embedding
// @shipfox/react-ui components in docs pages.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    AgentHandoff,
    Card: DocsCard,
    Cards,
    DocsImage,
    DocsVideo,
    IntegrationCatalog,
    ModelCatalog,
    TemplateGallery,
    TemplateDetail,
    ToolReference: ToolReferencePlaceholder,
    EventReference: EventReferencePlaceholder,
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
      <CodeBlock {...props} data-docs-code-block="">
        <Pre>{props.children}</Pre>
      </CodeBlock>
    ),
    ...components,
  };
}

// The page route binds the real components to the page's generated document.
function ToolReferencePlaceholder(): never {
  throw new Error('ToolReference requires a `toolReference` id in the page frontmatter.');
}

function EventReferencePlaceholder(): never {
  throw new Error('EventReference requires an `eventReference` id in the page frontmatter.');
}

function IntegrationCatalog() {
  return <IntegrationCatalogClient providers={getIntegrationCatalog()} />;
}

async function ModelCatalog() {
  return <ModelCatalogTable catalog={await getModelCatalog()} />;
}

function TemplateGallery() {
  return <TemplateGalleryClient templates={getTemplateCatalog()} />;
}
