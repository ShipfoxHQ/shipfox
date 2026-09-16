// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the catalog region is intentionally keyboard focusable for horizontal scrolling.
import {getRunnerCatalog, renderRunnerCatalogMarkdown} from '@/lib/runner-catalog';

const ALIGNMENT_CLASS_BY_HEADER: Record<string, string> = {
  CPU: 'text-right',
  Memory: 'text-right',
  'Workspace disk': 'text-right',
  'System disk': 'text-right',
  Price: 'text-right',
};

export async function RunnerCatalog() {
  const catalog = await getRunnerCatalog();
  const markdown = renderRunnerCatalogMarkdown(catalog);
  const lines = markdown.split('\n');
  const header = lines[0] ?? '';
  const rows = lines.slice(2);
  const headers = header
    .slice(1, -1)
    .split('|')
    .map((value) => value.trim());

  return (
    <section
      aria-label="Runner catalog"
      tabIndex={0}
      className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
    >
      <table>
        <thead>
          <tr>
            {headers.map((value) => (
              <th key={value} className={ALIGNMENT_CLASS_BY_HEADER[value]}>
                {value}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const values = row
              .slice(1, -1)
              .split('|')
              .map((value) => value.trim());
            return (
              <tr key={values[0]}>
                {values.map((value, index) => (
                  <td
                    key={`${values[0]}-${index}`}
                    className={ALIGNMENT_CLASS_BY_HEADER[headers[index] ?? '']}
                  >
                    {value
                      .split(/(`[^`]+`)/g)
                      .map((part, partIndex) =>
                        part.startsWith('`') && part.endsWith('`') ? (
                          <code key={partIndex}>{part.slice(1, -1)}</code>
                        ) : (
                          part
                        ),
                      )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export const runnerCatalogMarkdown = renderRunnerCatalogMarkdown;
