import {notFound} from 'next/navigation';
import {getLLMText} from '@/lib/get-llm-text';
import {source} from '@/lib/source';

export const revalidate = false;

const HOME_SLUG = 'home';

export async function GET(_req: Request, {params}: {params: Promise<{slug?: string[]}>}) {
  const {slug} = await params;
  if (!slug) notFound();
  const isHome = slug.length === 1 && slug[0] === HOME_SLUG;
  const page = source.getPage(isHome ? undefined : slug);
  if (!page) notFound();

  return new Response(await getLLMText(page, {audience: 'mcp'}), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export function generateStaticParams() {
  return source.generateParams().map(({slug}) => ({slug: slug?.length ? slug : [HOME_SLUG]}));
}
