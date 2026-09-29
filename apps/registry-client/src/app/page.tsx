import type {Metadata} from 'next';
import {CatalogView} from '@/components/catalog-view';
import {catalogFilters} from '@/lib/catalog';
import {registry} from '@/lib/registry';
import {publicUrl} from '@/lib/urls';

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export function generateMetadata(): Metadata {
  return {
    title: {absolute: 'Shipfox Registry: workflow templates and actions'},
    // Every filtered view of the catalog points search engines at the unfiltered one.
    alternates: {canonical: publicUrl()},
  };
}

export default async function CatalogPage({searchParams}: CatalogPageProps) {
  const filters = catalogFilters(await searchParams);
  const packages = await registry.listPackages(filters);
  return <CatalogView packages={packages} filters={filters} />;
}
