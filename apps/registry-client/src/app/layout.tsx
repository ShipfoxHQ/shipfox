import './global.css';
import {Icon} from '@shipfox/react-ui/icon';
import type {Metadata} from 'next';
import Link from 'next/link';
import type {ReactNode} from 'react';

export const metadata: Metadata = {
  title: {default: 'Shipfox Registry', template: '%s · Shipfox Registry'},
  description:
    'Workflow templates and actions for Shipfox, with signed versions that never change once published.',
};

export default function Layout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-background-subtle-base text-foreground-neutral-base antialiased">
        <header className="sticky top-0 z-10 border-b border-border-neutral-base bg-background-subtle-base">
          <div className="mx-auto flex h-56 w-full max-w-[1120px] items-center justify-between px-frame">
            <Link href="/" className="flex items-center gap-inline font-medium">
              <Icon
                name="shipfox"
                aria-hidden="true"
                className="size-20 text-foreground-highlight-interactive"
              />
              Shipfox Registry
            </Link>
            <a
              href="https://www.shipfox.io/docs"
              className="text-sm text-foreground-neutral-subtle hover:text-foreground-neutral-base"
            >
              Docs
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1120px] flex-1 px-frame py-frame">{children}</main>
      </body>
    </html>
  );
}
