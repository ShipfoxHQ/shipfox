// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the wide table needs keyboard focus for horizontal scrolling.

import {getIntegrationCatalog} from '@/lib/integration-catalog-source';
import {comparisonColumns, getComparisonSections} from '@/lib/solutions-comparison';

export function ComparisonTable() {
  const sections = getComparisonSections(getIntegrationCatalog());

  return (
    <div className="not-prose my-region">
      <p className="mb-inline text-sm text-fd-muted-foreground lg:hidden">Swipe to compare.</p>
      <section
        aria-label="Solutions comparison"
        className="overflow-x-auto rounded-lg border border-fd-border bg-fd-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
        tabIndex={0}
      >
        <table className="w-full min-w-[920px] table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">Compare approaches to engineering work</caption>
          <colgroup>
            <col className="w-[18%]" />
            {comparisonColumns.map(({key}) => (
              <col key={key} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 border-t-2 border-t-transparent bg-fd-background p-panel-compact align-top font-semibold"
              >
                <span className="sr-only">Comparison point</span>
              </th>
              {comparisonColumns.map(({key, label}) => (
                <th
                  scope="col"
                  key={key}
                  className={`border-t-2 p-panel-compact align-top font-semibold ${key === 'shipfox' ? 'border-t-fd-primary bg-fd-muted' : 'border-t-transparent'}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {Object.values(sections).map(({title, rows}) => (
            <tbody key={title}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={5}
                  className="border-t border-fd-border bg-fd-background p-panel-compact text-sm font-semibold"
                >
                  <span className="sticky left-0 inline-block">{title}</span>
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row.pain}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-fd-border bg-fd-background p-panel-compact align-top font-medium leading-6"
                  >
                    {row.pain}
                  </th>
                  {comparisonColumns.map(({key}) => (
                    <td
                      key={key}
                      className={`border-b border-fd-border p-panel-compact align-top leading-6 ${key === 'shipfox' ? 'bg-fd-muted' : ''}`}
                    >
                      {typeof row[key] === 'string' ? (
                        row[key]
                      ) : (
                        <ul className="grid gap-tight">
                          {row[key].map(({label, href}) => (
                            <li key={label}>
                              <a
                                href={href}
                                className="underline decoration-fd-border underline-offset-4 hover:decoration-fd-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
                              >
                                {label}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </section>
    </div>
  );
}
