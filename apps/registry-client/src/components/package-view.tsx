import {Header} from '@shipfox/react-ui/typography';
import {formatBytes} from '@shipfox/react-ui/utils/format-bytes';
import {ArrowRight, ChevronRight, Zap} from 'lucide-react';
import Link from 'next/link';
import type {ReactNode} from 'react';
import type {PackagePage, PackageVersion} from '@/lib/package-page';
import {packagePath} from '@/lib/urls';
import {ActionSections} from './action-sections';
import {AdoptPane} from './adopt-pane';
import {CopyButton} from './copy-button';
import {KindBadge} from './kind-badge';
import {Markdown} from './markdown';
import {ProviderIcons} from './provider-icon';
import {Publisher} from './publisher';
import {Section} from './section';
import {TemplateSections} from './template-sections';

const DATE_FORMAT = new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeZone: 'UTC'});

export function PackageView({page}: {page: PackagePage}) {
  const {details} = page;
  const {integrations} = details.metadata;
  return (
    <div className="flex flex-col gap-region">
      <div className="flex flex-col gap-cluster">
        <nav aria-label="Breadcrumb" className="flex items-center gap-tight text-sm">
          <Link href="/" className="text-foreground-neutral-subtle hover:underline">
            Registry
          </Link>
          <ChevronRight aria-hidden="true" className="size-14 text-foreground-neutral-muted" />
          <span className="font-code text-foreground-neutral-base">{page.package}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-cluster">
          <Header variant="h1" className="text-foreground-neutral-base">
            {page.title}
          </Header>
          <KindBadge kind={details.kind} />
        </div>
        <p className="max-w-[720px] text-md text-foreground-neutral-subtle">{page.summary}</p>
        {details.kind === 'template' ? (
          <p className="flex items-center gap-inline text-sm text-foreground-neutral-subtle">
            <Zap aria-hidden="true" className="size-16 shrink-0" />
            {details.manifest.starts}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-section gap-y-inline text-sm text-foreground-neutral-subtle">
          <span className="font-code text-foreground-neutral-base">{page.version}</span>
          <span>Published {DATE_FORMAT.format(new Date(page.publishedAt))}</span>
          <Publisher displayName={page.publisher.displayName} verified={page.publisher.verified} />
          {integrations.length > 0 ? <ProviderIcons providers={integrations} /> : null}
        </div>
      </div>

      <div className="grid gap-region xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-region">
          {page.readme ? (
            <Section title="Overview">
              <Markdown>{page.readme}</Markdown>
            </Section>
          ) : null}
          {details.kind === 'template' ? (
            <TemplateSections details={details} />
          ) : (
            <ActionSections details={details} />
          )}
          <Section title="Versions">
            <Versions versions={page.versions} kind={details.kind} />
          </Section>
          {page.related.length > 0 ? (
            <Section title="Related">
              <ul className="grid gap-inline sm:grid-cols-2">
                {page.related.map((related) => (
                  <li key={related.package}>
                    <Link
                      href={packagePath(related.package)}
                      className="flex items-center justify-between gap-inline rounded-6 border border-border-neutral-base bg-background-neutral-base px-row py-row text-sm font-medium text-foreground-neutral-base hover:bg-background-neutral-hover"
                    >
                      {related.title}
                      <ArrowRight
                        aria-hidden="true"
                        className="size-16 shrink-0 text-foreground-neutral-muted"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <aside className="order-first flex min-w-0 flex-col gap-group xl:sticky xl:top-80 xl:order-none xl:self-start">
          {details.kind === 'template' ? (
            <Card title="Set up this workflow">
              <p className="text-xs text-foreground-neutral-subtle">
                Open your coding agent in your repository and paste this prompt. The agent needs the{' '}
                <a
                  href="https://www.shipfox.io/docs/how-to/set-up-work/connect-mcp-client"
                  className="text-foreground-highlight-interactive underline"
                >
                  Shipfox MCP server
                </a>
                .
              </p>
              <AdoptPane packageName={page.package} roles={details.metadata.choices.roles} />
            </Card>
          ) : (
            <Card title="Use this action">
              <p className="text-xs text-foreground-neutral-subtle">
                Add this step to a job, then bind each connection to one of your workspace
                connections.
              </p>
              <Snippet code={details.metadata.usage} />
            </Card>
          )}
          <Card title="Details">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-group gap-y-inline text-sm">
              <Detail term="Version">{page.version}</Detail>
              <Detail term="License">{page.license}</Detail>
              <Detail term="Size">{formatBytes(details.metadata.size)}</Detail>
              <Detail term="Source">
                {page.source.url ? (
                  <a
                    href={page.source.url}
                    rel="noopener"
                    className="text-foreground-highlight-interactive underline"
                  >
                    {page.source.repository}
                  </a>
                ) : (
                  page.source.repository
                )}
              </Detail>
              <Detail term="Commit">
                <span className="font-code">{page.source.commit.slice(0, 12)}</span>
              </Detail>
              <Detail term="Digest">
                <span className="block truncate font-code" title={page.digest}>
                  {page.digest}
                </span>
              </Detail>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Versions({
  versions,
  kind,
}: {
  versions: PackageVersion[];
  kind: PackagePage['details']['kind'];
}) {
  return (
    <ol className="flex flex-col divide-y divide-border-neutral-base overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      {versions.map((version) => (
        <li key={version.version} className="flex flex-col gap-inline px-row py-row">
          <span className="flex flex-wrap items-center gap-x-group gap-y-tight text-sm">
            <span className="font-code font-medium text-foreground-neutral-base">
              {version.version}
            </span>
            <span className="text-foreground-neutral-muted">
              {DATE_FORMAT.format(new Date(version.publishedAt))}
            </span>
            {version.bump ? (
              <span className="text-foreground-neutral-subtle">{BUMP_LABELS[version.bump]}</span>
            ) : null}
            {kind === 'action' && version.capabilityChange ? (
              <span className="font-medium text-foreground-neutral-base">Changes permissions</span>
            ) : null}
          </span>
          {version.changelog ? (
            <Markdown className="text-foreground-neutral-subtle">{version.changelog}</Markdown>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const BUMP_LABELS = {major: 'Major release', minor: 'Minor release', patch: 'Patch release'};

function Card({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="flex flex-col gap-cluster rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact shadow-button-neutral">
      <h2 className="text-sm font-medium text-foreground-neutral-base">{title}</h2>
      {children}
    </section>
  );
}

function Snippet({code}: {code: string}) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-6 bg-background-contrast-base p-panel-compact pr-40 font-code text-xs leading-20 text-foreground-contrast-primary">
        {code}
      </pre>
      <span className="absolute top-6 right-6 text-foreground-contrast-secondary">
        <CopyButton text={code} label="Copy usage" />
      </span>
    </div>
  );
}

function Detail({term, children}: {term: string; children: ReactNode}) {
  return (
    <>
      <dt className="text-foreground-neutral-muted">{term}</dt>
      <dd className="min-w-0 text-foreground-neutral-base">{children}</dd>
    </>
  );
}
