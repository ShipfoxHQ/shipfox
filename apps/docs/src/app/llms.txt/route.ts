import {source} from '@/lib/source';
import {toUrl} from '@/url';

export const revalidate = false;

const SECTION_ORDER = [
  'get-started',
  'concepts',
  'integrations',
  'guides',
  'ai',
  'reference',
  'installation',
  'help',
] as const;

const SECTION_LABELS: Record<(typeof SECTION_ORDER)[number], string> = {
  'get-started': 'Get Started',
  concepts: 'Core Concepts',
  integrations: 'Integrations',
  guides: 'Guides',
  ai: 'AI Assistance',
  reference: 'Reference',
  installation: 'Installation',
  help: 'Help',
};

// Root-level pages have no folder segment, so map them explicitly; everything
// else buckets by its first path segment. Keep this exhaustive so no page is
// dropped from llms.txt.
function sectionOf(url: string): (typeof SECTION_ORDER)[number] {
  if (url === '/' || url === '/introduction' || url === '/getting-started') return 'get-started';
  if (url === '/troubleshooting' || url === '/faq') return 'help';
  const segment = url.split('/').filter(Boolean)[0];
  return (SECTION_ORDER as readonly string[]).includes(segment ?? '')
    ? (segment as (typeof SECTION_ORDER)[number])
    : 'get-started';
}

export function GET() {
  const pages = source.getPages();

  const sections = new Map<string, typeof pages>();
  for (const section of SECTION_ORDER) {
    sections.set(section, []);
  }

  for (const page of pages) {
    sections.get(sectionOf(page.url))?.push(page);
  }

  for (const [, sectionPages] of sections) {
    sectionPages.sort((a, b) => {
      const aSegments = a.url.split('/').filter(Boolean);
      const bSegments = b.url.split('/').filter(Boolean);
      const aIsIndex = aSegments.length <= 1;
      const bIsIndex = bSegments.length <= 1;
      if (aIsIndex && !bIsIndex) return -1;
      if (!aIsIndex && bIsIndex) return 1;
      return a.url.localeCompare(b.url);
    });
  }

  const lines: string[] = [
    '# Shipfox Documentation',
    '',
    '> Shipfox is a continuous shipping platform for engineering teams. Define YAML workflows in your repo, run shell and AI agent steps on your own runners, and trigger pipelines from GitHub, Sentry, and more.',
    '',
  ];

  for (const sectionKey of SECTION_ORDER) {
    const sectionPages = sections.get(sectionKey);
    if (!sectionPages?.length) continue;

    lines.push(`## ${SECTION_LABELS[sectionKey]}`, '');

    for (const page of sectionPages) {
      const description = page.data.description as string | undefined;
      const entry = description
        ? `- [${page.data.title}](${toUrl(page.url)}): ${description}`
        : `- [${page.data.title}](${toUrl(page.url)})`;
      lines.push(entry);
    }

    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
  });
}
