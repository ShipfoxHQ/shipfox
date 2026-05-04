import {Header, Text} from '@shipfox/react-ui';
import type {ReactNode} from 'react';

export function SetupPageShell({
  heading,
  subtitle,
  children,
  footer,
}: {
  heading: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-24">
        <header className="flex flex-col gap-8">
          <Header variant="h1">{heading}</Header>
          {subtitle ? (
            <Text size="md" className="text-foreground-neutral-muted">
              {subtitle}
            </Text>
          ) : null}
        </header>
        <section className="flex flex-col gap-20">{children}</section>
        {footer ? <footer className="flex items-center gap-12">{footer}</footer> : null}
      </div>
    </main>
  );
}
