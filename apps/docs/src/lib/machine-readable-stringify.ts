import type {LLMsOptions} from 'fumadocs-core/mdx-plugins';

// Build-time half of the machine-readable pipeline. `source.config.ts` loads this
// file, so it must stay free of imports that the config loader can't resolve,
// such as the skill catalog behind `renderAgentHandoff`.
const STEP_TITLE_PATTERN = /^\*\*(.*)\*\*$/s;

type StringifyCallback = NonNullable<LLMsOptions['stringify']>;
type StringifyNode = Parameters<StringifyCallback>[0];
type StringifyState = Parameters<StringifyCallback>[2];
type StringifyInfo = Parameters<StringifyCallback>[3];
type FlowParent = Parameters<StringifyState['containerFlow']>[0];
type PhrasingParent = Parameters<StringifyState['containerPhrasing']>[0];

interface MdxAttribute {
  type: string;
  name: string;
  value: unknown;
}

interface MdxElementNode {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  attributes: MdxAttribute[];
  children: StringifyNode[];
}

export const stringifyMachineReadableComponent: StringifyCallback = (
  node,
  _parent,
  state,
  info,
) => {
  if (!isMdxElement(node)) return undefined;

  switch (node.name) {
    case 'ForHumans':
      return forHumansPlaceholder(node, state, info);
    case 'EditionsComparison':
      return `\0${JSON.stringify({name: 'EditionsComparison', children: '', attributes: {}})}\0`;
    case 'ComparisonTable':
      return `\0${JSON.stringify({name: 'ComparisonTable', children: '', attributes: {}})}\0`;
    case 'ModelCatalog':
      return `\0${JSON.stringify({name: 'ModelCatalog', children: '', attributes: {}})}\0`;
    case 'TemplateGallery':
      return `\0${JSON.stringify({name: 'TemplateGallery', children: '', attributes: {}})}\0`;
    case 'WorkflowOverview':
      return `\0${JSON.stringify({name: 'WorkflowOverview', children: '', attributes: {}})}\0`;
    case 'TemplateDetail':
      return `\0${JSON.stringify({name: 'TemplateDetail', children: '', attributes: {id: attributeValue(node, 'id')}})}\0`;
    case 'AgentHandoff':
      return agentHandoffPlaceholder(node);
    case 'Callout':
      return blockquote(
        childrenMarkdown(node, state, info),
        calloutLabel(attributeValue(node, 'title'), attributeValue(node, 'type')),
      );
    case 'div':
    case 'Steps':
    case 'Cards':
    case 'Accordions':
    case 'Tabs':
    case 'Frame':
      return childrenMarkdown(node, state, info);
    case 'Card':
      return titledBlock(
        attributeValue(node, 'title'),
        attributeValue(node, 'href'),
        childrenMarkdown(node, state, info),
        '###',
      );
    case 'Accordion':
      return titledBlock(
        attributeValue(node, 'title'),
        undefined,
        childrenMarkdown(node, state, info),
        '###',
      );
    case 'Step':
      return stepMarkdown(node, state, info);
    case 'Tab':
      return titledBlock(
        attributeValue(node, 'title') ??
          attributeValue(node, 'label') ??
          attributeValue(node, 'value'),
        undefined,
        childrenMarkdown(node, state, info),
        '####',
      );
    default:
      return undefined;
  }
};

function childrenMarkdown(
  node: MdxElementNode,
  state: StringifyState,
  info: StringifyInfo,
): string {
  return state.containerFlow({type: 'root', children: node.children} as FlowParent, info).trim();
}

function titledBlock(
  title: string | undefined,
  href: string | undefined,
  content: string,
  level: string,
): string {
  const cleanTitle = title?.trim().replace(/\s+/g, ' ');
  let heading: string | undefined;
  if (cleanTitle) {
    heading = href
      ? `${level} [${cleanTitle.replaceAll(']', '\\]')}](${href})`
      : `${level} ${cleanTitle}`;
  }

  return [heading, content].filter(Boolean).join('\n\n');
}

function stepMarkdown(node: MdxElementNode, state: StringifyState, info: StringifyInfo): string {
  const first = node.children[0];
  if (first?.type !== 'paragraph' || first.children.length !== 1) {
    return childrenMarkdown(node, state, info);
  }

  const onlyChild = first.children[0];
  if (onlyChild?.type !== 'strong') return childrenMarkdown(node, state, info);

  const title = state
    .containerPhrasing(first as PhrasingParent, info)
    .replace(STEP_TITLE_PATTERN, '$1')
    .trim();
  const content = state
    .containerFlow({type: 'root', children: node.children.slice(1)} as FlowParent, info)
    .trim();
  return [`### ${title}`, content].filter(Boolean).join('\n\n');
}

function agentHandoffPlaceholder(node: MdxElementNode): string {
  if (node.type !== 'mdxJsxFlowElement') {
    throw new Error('AgentHandoff must be a block on its own line, not part of a paragraph.');
  }
  const skill = attributeValue(node, 'skill');
  const prompt = attributeValue(node, 'prompt');
  if (!skill || !prompt) throw new Error('AgentHandoff requires a skill and a prompt.');
  return `\0${JSON.stringify({name: 'AgentHandoff', children: '', attributes: {skill, prompt}})}\0`;
}

function blockquote(content: string, label?: string): string {
  const lines = content ? content.split('\n') : [];
  if (label) lines.unshift(`**${label}**`);
  if (lines.length === 0) return label ? `> **${label}**` : '';
  return lines.map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function calloutLabel(title?: string, type?: string): string | undefined {
  const cleanTitle = title?.trim();
  const cleanType = type?.trim();
  if (cleanTitle && cleanType) return `${cleanTitle} (${cleanType})`;
  return cleanTitle || cleanType;
}

function forHumansPlaceholder(
  node: MdxElementNode,
  state: StringifyState,
  info: StringifyInfo,
): string {
  if (node.type !== 'mdxJsxFlowElement') {
    throw new Error('ForHumans must be a block on its own line, not part of a paragraph.');
  }

  const children = childrenMarkdown(node, state, info);
  if (children.includes('\0')) {
    throw new Error('ForHumans cannot contain a generated component.');
  }
  return `\0${JSON.stringify({name: 'ForHumans', children, attributes: {}})}\0`;
}

function attributeValue(node: MdxElementNode, name: string): string | undefined {
  const attribute = node.attributes.find(
    (item) => item.type === 'mdxJsxAttribute' && item.name === name,
  );
  return attribute && typeof attribute.value === 'string' ? attribute.value : undefined;
}

function isMdxElement(node: StringifyNode): node is StringifyNode & MdxElementNode {
  return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
}
