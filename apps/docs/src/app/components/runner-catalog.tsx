// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the catalog region is intentionally keyboard focusable for horizontal scrolling.
import {
  formatRunnerPrice,
  getRunnerCatalog,
  renderRunnerCatalogMarkdown,
} from '@/lib/runner-catalog';

export async function RunnerCatalog() {
  const catalog = await getRunnerCatalog();

  return (
    <section
      aria-label="Runner catalog"
      tabIndex={0}
      className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
    >
      <table className="w-full">
        <caption className="sr-only">Available Shipfox-hosted runners</caption>
        <thead>
          <tr>
            <th scope="col">Runner</th>
            <th className="text-right" scope="col">
              Compute
            </th>
            <th className="text-right" scope="col">
              Workspace disk
            </th>
            <th className="text-right" scope="col">
              Price
            </th>
          </tr>
        </thead>
        <tbody>
          {catalog.runners.map((runner) => (
            <tr key={runner.id}>
              <th className="whitespace-nowrap align-top" scope="row">
                <span className="flex flex-col items-start gap-tight">
                  <code>{runner.id}</code>
                  {runner.aliases.length > 0 ? (
                    <span className="text-xs font-normal text-fd-muted-foreground">
                      {runner.aliases.length === 1 ? 'Alias: ' : 'Aliases: '}
                      {runner.aliases.map((alias, index) => (
                        <span key={alias}>
                          {index > 0 ? ', ' : null}
                          <code>{alias}</code>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </th>
              <td className="whitespace-nowrap text-right align-top tabular-nums">
                {runner.cpu} vCPU · {runner.memory_gib} GiB
              </td>
              <td className="whitespace-nowrap text-right align-top tabular-nums">
                {runner.workspace_disk_gib} GiB
              </td>
              <td className="whitespace-nowrap text-right align-top tabular-nums">
                {formatRunnerPrice(runner)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export const runnerCatalogMarkdown = renderRunnerCatalogMarkdown;
