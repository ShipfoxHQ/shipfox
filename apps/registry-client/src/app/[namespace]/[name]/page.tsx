import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {cache} from 'react';
import {PackageView} from '@/components/package-view';
import {loadPackagePage} from '@/lib/package-page';
import {registry} from '@/lib/registry';
import {packagePath, publicUrl} from '@/lib/urls';

// Rendered on first visit and refreshed at most every minute, so a publish shows within a minute.
export const revalidate = 60;

interface PackagePageProps {
  params: Promise<{namespace: string; name: string}>;
}

// No page renders at build time: the registry API is only reachable at runtime.
export function generateStaticParams(): {namespace: string; name: string}[] {
  return [];
}

const load = cache((namespace: string, name: string) =>
  loadPackagePage({api: registry, namespace, name}),
);

export async function generateMetadata({params}: PackagePageProps): Promise<Metadata> {
  const {namespace, name} = await params;
  const page = await load(namespace, name);
  if (page === undefined) return {};
  const url = publicUrl(packagePath(page.package));
  return {
    title: `${page.title} (${page.package})`,
    description: page.summary,
    keywords: page.keywords,
    alternates: {canonical: url},
    openGraph: {title: page.title, description: page.summary, url, type: 'website'},
  };
}

export default async function PackageRoute({params}: PackagePageProps) {
  const {namespace, name} = await params;
  const page = await load(namespace, name);
  if (page === undefined) notFound();
  return <PackageView page={page} />;
}
