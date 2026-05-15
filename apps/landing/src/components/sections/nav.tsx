'use client';

import {Icon} from '@shipfox/react-ui';
import {useEffect, useState} from 'react';
import {CtaButton} from '../cta/cta-button';

const NAV_LINKS = [
  {href: '#what', label: 'Product'},
  {href: '#integrations', label: 'Integrations'},
  {href: '#use-cases', label: 'Use cases'},
  {href: '#platform', label: 'Platform'},
  {href: '#pricing', label: 'Pricing'},
];

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the drawer if the viewport grows past the md breakpoint while it's open.
  useEffect(() => {
    if (!menuOpen) return;
    const mql = window.matchMedia('(min-width: 768px)');
    function onChange(e: MediaQueryListEvent) {
      if (e.matches) setMenuOpen(false);
    }
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [menuOpen]);

  // Close on Escape key.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <nav className="border-alpha-white-6 sticky top-0 z-50 border-b bg-[rgba(15,15,16,.78)] backdrop-blur-md">
      <div className="wrap flex h-48 md:h-56 w-full items-center gap-12 md:gap-28">
        <a
          href="#hero"
          className="flex items-center gap-10"
          onClick={() => setMenuOpen(false)}
        >
          <Icon name="shipfox" className="h-28 w-28 md:h-32 md:w-32 shrink-0" />
          <span className="font-display text-foreground-neutral-base text-2xl font-bold leading-none tracking-tight">
            Shipfox
          </span>
        </a>
        <ul className="hidden md:flex list-none gap-24 p-0 m-0">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <NavLink href={l.href}>{l.label}</NavLink>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-10 md:gap-14">
          <a
            href="/sign-in"
            className="hidden md:inline-flex text-foreground-neutral-base hover:text-foreground-neutral-base text-base font-medium leading-none no-underline"
          >
            Sign in
          </a>
          <CtaButton size="md">Get started</CtaButton>
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-drawer"
            onClick={() => setMenuOpen((v) => !v)}
            className="text-foreground-neutral-base hover:bg-alpha-white-4 -mr-6 flex size-36 cursor-pointer items-center justify-center rounded-6 border-0 bg-transparent md:hidden"
          >
            <Icon name={menuOpen ? 'closeLine' : 'menuLine'} className="size-22" />
          </button>
        </div>
      </div>
      {menuOpen && (
        <>
          {/* Backdrop: click anywhere outside the drawer to close. */}
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 top-48 z-40 cursor-default border-0 bg-[rgba(0,0,0,.4)] md:hidden"
          />
          <div
            id="mobile-nav-drawer"
            className="border-alpha-white-6 relative z-50 border-t bg-[rgba(15,15,16,.96)] backdrop-blur-md md:hidden"
          >
            <ul className="wrap m-0 flex list-none flex-col gap-2 py-12">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="text-foreground-neutral-base hover:bg-alpha-white-4 flex rounded-6 px-12 py-14 text-base font-medium leading-none no-underline"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
              <li className="border-alpha-white-6 mt-8 border-t pt-12">
                <a
                  href="/sign-in"
                  onClick={() => setMenuOpen(false)}
                  className="text-foreground-neutral-base hover:bg-alpha-white-4 flex rounded-6 px-12 py-14 text-base font-medium leading-none no-underline"
                >
                  Sign in
                </a>
              </li>
            </ul>
          </div>
        </>
      )}
    </nav>
  );
}

function NavLink({href, children}: {href: string; children: React.ReactNode}) {
  return (
    <a
      href={href}
      className="text-foreground-neutral-subtle hover:text-foreground-neutral-base text-base font-medium leading-none no-underline transition-colors"
    >
      {children}
    </a>
  );
}
