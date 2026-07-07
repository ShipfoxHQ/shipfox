import {source} from '@/lib/source';
import {toUrl} from '@/url';

export const revalidate = false;

const SECTION_ORDER = ['', 'runners', 'cache', 'observability', 'integrations'];

const SECTION_LABELS: Record<string, string> = {
  '': 'Introduction',
  runners: 'Runners',
  cache: 'Caching',
  observability: 'Observability',
  integrations: 'Integrations',
};

export function GET() {
  const pages = source.getPages();

  const sections = new Map<string, typeof pages>();
  for (const section of SECTION_ORDER) {
    sections.set(section, []);
  }

  for (const page of pages) {
    const segment = page.url.split('/').filter(Boolean)[0] ?? '';
    sections.get(segment)?.push(page);
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
    '> Shipfox is a CI platform fully integrated with GitHub Actions. Shipfox runners are 2x faster and 50% cheaper than GitHub-hosted runners, with built-in remote caching and complete CI observability.',
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
