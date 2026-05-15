'use client';

import {Icon} from '@shipfox/react-ui';

const COLUMNS: {title: string; links: string[]}[] = [
  {
    title: 'Product',
    links: ['What it is', 'Integrations', 'Use cases', 'Platform', 'Pricing'],
  },
  {
    title: 'Resources',
    links: ['Docs', 'Changelog', 'Status', 'Blog', 'Security'],
  },
  {
    title: 'Company',
    links: ['About', 'Customers', 'Careers', 'Brand', 'Contact'],
  },
  {
    title: 'Legal',
    links: ['Terms', 'Privacy', 'DPA', 'SOC 2'],
  },
];

const PRODUCT_HASHES = ['#what', '#integrations', '#use-cases', '#platform', '#pricing'];

export function Footer() {
  return (
    <>
      <footer className="bg-neutral-1000 px-0 pb-24 pt-56">
        <div className="wrap grid grid-cols-2 sm:grid-cols-3 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr] gap-24 md:gap-32">
          <div>
            <Icon name="shipfox" className="mb-14 h-22 w-22" />
            <p className="font-display text-foreground-neutral-muted m-0 max-w-[280px] text-sm font-normal leading-[20px]">
              Continuous shipping for engineering teams. Open source, managed cloud, or fully
              self-hosted.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-foreground-neutral-muted font-code mb-14 text-xs font-medium uppercase leading-none tracking-[.08em]">
                {col.title}
              </h4>
              {col.links.map((link, i) => {
                const href =
                  col.title === 'Product' && PRODUCT_HASHES[i]
                    ? PRODUCT_HASHES[i]
                    : `/${link.toLowerCase().replace(/\s+/g, '-')}`;
                return (
                  <a
                    key={link}
                    href={href}
                    className="font-display text-foreground-neutral-subtle hover:text-foreground-neutral-base block py-6 text-sm font-normal leading-none no-underline"
                  >
                    {link}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      </footer>
      <div className="border-alpha-white-6 text-foreground-neutral-muted font-code border-t py-18 text-xs leading-none">
        <div className="wrap flex flex-wrap items-center gap-y-8">
          <span className="text-primary-400">/shipfox · 2026</span>
          <span className="mx-12 opacity-40 hidden md:inline">·</span>
          <span className="hidden md:inline">region eu-west-1 · all systems operational</span>
          <div className="ml-auto flex gap-18">
            <a href="/status" className="text-foreground-neutral-muted no-underline">
              Status ↗
            </a>
            <a href="/github" className="text-foreground-neutral-muted no-underline">
              GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
