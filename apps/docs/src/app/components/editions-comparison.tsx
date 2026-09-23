import Link from 'next/link';
import {type Edition, type EditionFeature, editions} from '@/lib/editions';

const actionClassName =
  'inline-flex min-h-10 items-center justify-center rounded-md px-row text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring';

export function EditionsComparison() {
  return (
    <>
      <div className="not-prose my-region hidden overflow-hidden rounded-lg border border-fd-border bg-fd-card xl:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">Shipfox editions comparison</caption>
          <colgroup>
            <col className="w-[18%]" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={5} className="bg-fd-muted/40 p-panel align-top">
                <span className="sr-only">Capability</span>
              </th>
              {editions.map((edition) => (
                <th
                  scope="col"
                  key={edition.id}
                  className={`border-t-2 px-[var(--pad-panel)] pt-[var(--pad-panel)] pb-[var(--space-group)] align-top ${edition.featured ? 'border-t-fd-primary bg-fd-muted' : 'border-t-transparent'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-inline">
                    <h2
                      id={`${edition.id}-desktop`}
                      className="text-lg font-semibold text-fd-foreground"
                    >
                      {edition.name}
                    </h2>
                    {edition.featured ? (
                      <span className="rounded-md border border-fd-primary px-tight text-xs font-medium text-fd-primary">
                        Most teams start here
                      </span>
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              {editions.map((edition) => (
                <td
                  key={edition.id}
                  className={`px-[var(--pad-panel)] pb-[var(--space-group)] align-top ${edition.featured ? 'bg-fd-muted' : ''}`}
                >
                  <p className="text-3xl font-semibold leading-tight tracking-tight text-fd-foreground">
                    {edition.price}
                  </p>
                </td>
              ))}
            </tr>
            <tr>
              {editions.map((edition) => (
                <td
                  key={edition.id}
                  className={`px-[var(--pad-panel)] pb-[var(--space-group)] align-top ${edition.featured ? 'bg-fd-muted' : ''}`}
                >
                  <p className="text-sm leading-6 text-fd-muted-foreground">{edition.summary}</p>
                </td>
              ))}
            </tr>
            <tr>
              {editions.map((edition) => (
                <td
                  key={edition.id}
                  className={`px-[var(--pad-panel)] text-center align-top ${edition.featured ? 'bg-fd-muted' : ''}`}
                >
                  {edition.secondaryAction ? (
                    <EditionLink
                      href={edition.secondaryAction.href}
                      className="text-sm text-fd-muted-foreground underline underline-offset-4 hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
                    >
                      {edition.secondaryAction.label}
                    </EditionLink>
                  ) : null}
                </td>
              ))}
            </tr>
            <tr>
              {editions.map((edition) => (
                <td
                  key={edition.id}
                  className={`px-[var(--pad-panel)] pt-[var(--space-cluster)] pb-[var(--pad-panel)] align-top ${edition.featured ? 'bg-fd-muted' : ''}`}
                >
                  <EditionLink
                    href={edition.action.href}
                    className={`${actionClassName} w-full ${edition.featured ? 'bg-fd-foreground text-fd-background hover:opacity-85' : 'border border-fd-border bg-fd-card text-fd-foreground hover:bg-fd-muted'}`}
                  >
                    {edition.action.label}
                  </EditionLink>
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            <CategoryRow label="Infrastructure" />
            <ComparisonRow
              label="Deployment"
              values={editions.map((edition) => edition.infrastructure.deployment)}
            />
            <ComparisonRow
              label="Compute"
              values={editions.map((edition) => (
                <FeatureValue feature={edition.infrastructure.compute} key={edition.id} />
              ))}
            />
            <ComparisonRow
              label="Inference"
              values={editions.map((edition) => (
                <FeatureValue feature={edition.infrastructure.inference} key={edition.id} />
              ))}
            />
          </tbody>
          <tbody>
            <CategoryRow label="Authentication and permissions" />
            <ComparisonRow
              label="Access"
              values={editions.map((edition) => (
                <PlainList items={edition.access} key={edition.id} />
              ))}
            />
          </tbody>
          <tbody>
            <CategoryRow label="Features and support" />
            <ComparisonRow
              label="Included"
              values={editions.map((edition) => (
                <FeatureList features={edition.features} key={edition.id} />
              ))}
            />
          </tbody>
        </table>
      </div>

      <div className="not-prose my-region overflow-hidden rounded-lg border border-fd-border bg-fd-card xl:hidden">
        {editions.map((edition) => (
          <section
            aria-labelledby={`${edition.id}-mobile`}
            className={`grid gap-section border-b border-fd-border p-panel last:border-b-0 ${edition.featured ? 'border-t-2 border-t-fd-primary' : ''}`}
            key={edition.id}
          >
            <EditionHeading edition={edition} headingId={`${edition.id}-mobile`} />
            <div className="grid gap-group border-t border-fd-border pt-section">
              <h3 className="text-sm font-semibold">Infrastructure</h3>
              <dl className="grid gap-group text-sm leading-6">
                <MobileDetail label="Deployment">{edition.infrastructure.deployment}</MobileDetail>
                <MobileDetail label="Compute">
                  <FeatureValue feature={edition.infrastructure.compute} />
                </MobileDetail>
                <MobileDetail label="Inference">
                  <FeatureValue feature={edition.infrastructure.inference} />
                </MobileDetail>
              </dl>
            </div>
            <div className="grid gap-group border-t border-fd-border pt-section">
              <h3 className="text-sm font-semibold">Authentication and permissions</h3>
              <PlainList items={edition.access} />
            </div>
            <div className="grid gap-group border-t border-fd-border pt-section">
              <h3 className="text-sm font-semibold">Features and support</h3>
              <FeatureList features={edition.features} />
            </div>
            <EditionActions edition={edition} />
          </section>
        ))}
      </div>
    </>
  );
}

function CategoryRow({label}: {label: string}) {
  return (
    <tr>
      <th
        scope="rowgroup"
        colSpan={4}
        className="border-t border-fd-border bg-fd-card p-panel-compact text-sm font-semibold"
      >
        {label}
      </th>
    </tr>
  );
}

function ComparisonRow({label, values}: {label: string; values: readonly React.ReactNode[]}) {
  return (
    <tr>
      <th scope="row" className="bg-fd-muted/40 p-panel-compact align-top font-medium">
        {label}
      </th>
      {values.map((value, index) => (
        <td
          className={`p-panel-compact align-top leading-6 ${index === 1 ? 'bg-fd-muted' : ''}`}
          key={editions[index].id}
        >
          {value}
        </td>
      ))}
    </tr>
  );
}

function MobileDetail({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div>
      <dt className="text-xs font-medium text-fd-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EditionHeading({edition, headingId}: {edition: Edition; headingId: string}) {
  return (
    <div className="grid gap-group">
      <div className="flex flex-wrap items-center justify-between gap-inline">
        <h2 id={headingId} className="text-lg font-semibold text-fd-foreground">
          {edition.name}
        </h2>
        {edition.featured ? (
          <span className="rounded-md border border-fd-primary px-tight text-xs font-medium text-fd-primary">
            Most teams start here
          </span>
        ) : null}
      </div>
      <p className="text-3xl font-semibold leading-tight tracking-tight text-fd-foreground">
        {edition.price}
      </p>
      <p className="text-sm font-normal leading-6 text-fd-muted-foreground">{edition.summary}</p>
    </div>
  );
}

function EditionActions({edition}: {edition: Edition}) {
  return (
    <div className="grid gap-cluster">
      {edition.secondaryAction ? (
        <EditionLink
          href={edition.secondaryAction.href}
          className="text-center text-sm font-normal text-fd-muted-foreground underline underline-offset-4 hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
        >
          {edition.secondaryAction.label}
        </EditionLink>
      ) : null}
      <EditionLink
        href={edition.action.href}
        className={`${actionClassName} ${edition.featured ? 'bg-fd-foreground text-fd-background hover:opacity-85' : 'border border-fd-border bg-fd-card text-fd-foreground hover:bg-fd-muted'}`}
      >
        {edition.action.label}
      </EditionLink>
    </div>
  );
}

function FeatureValue({feature}: {feature: EditionFeature}) {
  return (
    <>
      {feature.href ? (
        <Link href={feature.href} className="font-medium underline underline-offset-4">
          {feature.label}
        </Link>
      ) : (
        feature.label
      )}
      {feature.detail ? (
        <span className="block text-fd-muted-foreground">{feature.detail}</span>
      ) : null}
    </>
  );
}

function FeatureList({features}: {features: readonly EditionFeature[]}) {
  return (
    <ul className="grid gap-group text-sm leading-6">
      {features.map((feature) => (
        <li key={feature.label}>
          <FeatureValue feature={feature} />
        </li>
      ))}
    </ul>
  );
}

function PlainList({items}: {items: readonly string[]}) {
  return (
    <ul className="grid gap-group text-sm leading-6">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function EditionLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
