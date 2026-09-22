import {source} from '@/lib/source';

const SECTION_ORDER = [
  'get-started',
  'tutorials',
  'understand',
  'how-to',
  'integrations',
  'ai',
  'reference',
  'operations',
  'installation',
] as const;

type SectionKey = (typeof SECTION_ORDER)[number];

const SECTION_LABELS: Record<SectionKey, string> = {
  'get-started': 'Get Started',
  tutorials: 'Tutorials',
  understand: 'Understand',
  'how-to': 'How-to Guides',
  integrations: 'Integrations',
  ai: 'AI Assistance',
  reference: 'Reference',
  operations: 'Operations',
  installation: 'Installation',
};

export interface CatalogPage {
  title: string;
  description: string;
  url: string;
}

export interface CatalogSection {
  label: string;
  pages: CatalogPage[];
}

// Root-level pages have no folder segment, so map them explicitly; everything
// else buckets by its first path segment. Keep this exhaustive so no page is
// dropped from the catalog.
function sectionOf(url: string): SectionKey {
  if (url === '/' || url === '/getting-started') return 'get-started';
  const segment = url.split('/').filter(Boolean)[0];
  return (SECTION_ORDER as readonly string[]).includes(segment ?? '')
    ? (segment as SectionKey)
    : 'get-started';
}

interface TreePage {
  type: 'page';
  url: string;
}
interface TreeFolder {
  type: 'folder';
  index?: TreePage;
  children: TreeNode[];
}
type TreeNode = TreePage | TreeFolder | {type: 'separator'};

// Flatten the sidebar tree (which honours each folder's meta.json order) into an
// ordered list of URLs, so the catalog reads in the same order as the docs nav
// rather than alphabetically.
function collectNavOrder(nodes: TreeNode[], acc: string[]): string[] {
  for (const node of nodes) {
    if (node.type === 'page') acc.push(node.url);
    else if (node.type === 'folder') {
      if (node.index) acc.push(node.index.url);
      collectNavOrder(node.children, acc);
    }
  }
  return acc;
}

/**
 * Every documentation page, grouped by top-level section and ordered the way the
 * sidebar orders them. Backs both `llms.txt` and the catalog Ask AI carries in
 * its instructions, so a new page reaches both surfaces without a second list.
 *
 * Throws when a page is missing its description, because both consumers rely on
 * the description to say what the page is for.
 */
export function collectPageCatalog(): CatalogSection[] {
  const navOrder = collectNavOrder(source.pageTree.children as unknown as TreeNode[], []);
  const orderIndex = new Map(navOrder.map((url, index) => [url, index]));

  const grouped = new Map<SectionKey, CatalogPage[]>(SECTION_ORDER.map((key) => [key, []]));
  for (const page of source.getPages()) {
    const description = page.data.description;
    if (typeof description !== 'string' || description.length === 0) {
      throw new Error(`Documentation page "${page.path}" (${page.url}) is missing a description.`);
    }
    grouped.get(sectionOf(page.url))?.push({title: page.data.title, description, url: page.url});
  }

  const sections: CatalogSection[] = [];
  for (const key of SECTION_ORDER) {
    const pages = grouped.get(key);
    if (!pages?.length) continue;
    pages.sort((a, b) => (orderIndex.get(a.url) ?? Infinity) - (orderIndex.get(b.url) ?? Infinity));
    sections.push({label: SECTION_LABELS[key], pages});
  }
  return sections;
}
