import type {InferPageType} from 'fumadocs-core/source';
import type {source} from '@/lib/source';
import {toUrl} from '@/url';

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText('processed');
  // toUrl carries the /docs basePath, matching the llms.txt route, so the
  // full-text and per-page markdown advertise canonical URLs.
  return `# ${page.data.title} (${toUrl(page.url)})\n\n${processed}`;
}
