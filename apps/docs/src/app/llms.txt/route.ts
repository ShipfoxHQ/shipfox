import {canonicalDocsUrl} from '@/lib/machine-readable';
import {collectPageCatalog} from '@/lib/page-catalog';
import {PRODUCT_DESCRIPTION, PRODUCT_SUBTITLE} from '@/lib/product-definition';

export const revalidate = false;

export function GET() {
  const lines: string[] = [
    '# Shipfox Documentation',
    '',
    `> ${PRODUCT_SUBTITLE} ${PRODUCT_DESCRIPTION}`,
    '',
  ];

  for (const section of collectPageCatalog()) {
    lines.push(`## ${section.label}`, '');
    for (const page of section.pages) {
      lines.push(`- [${page.title}](${canonicalDocsUrl(page.url)}): ${page.description}`);
    }
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
  });
}
