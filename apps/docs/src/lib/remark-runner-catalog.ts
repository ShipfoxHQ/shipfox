import {getRunnerCatalog, renderRunnerCatalogMarkdown} from './runner-catalog';

interface RootNode {
  children: unknown[];
}

interface MdxElementNode {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  children: unknown[];
  data?: Record<string, unknown>;
}

export function remarkRunnerCatalog() {
  return async (tree: RootNode) => {
    const catalog = await getRunnerCatalog();
    walk(tree, (node) => {
      if (node.name !== 'RunnerCatalog') return;
      node.data ??= {};
      node.data._stringify = {text: renderRunnerCatalogMarkdown(catalog)};
    });
  };
}

function walk(value: unknown, callback: (node: MdxElementNode) => void): void {
  if (!isRecord(value)) return;
  if (isMdxElement(value)) callback(value);
  if (!Array.isArray(value.children)) return;
  for (const child of value.children) walk(child, callback);
}

function isMdxElement(
  value: Record<string, unknown>,
): value is MdxElementNode & Record<string, unknown> {
  return (
    (value.type === 'mdxJsxFlowElement' || value.type === 'mdxJsxTextElement') &&
    (typeof value.name === 'string' || value.name === null) &&
    Array.isArray(value.children)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
