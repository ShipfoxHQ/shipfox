import {getRunnerCatalog, renderRunnerCatalogMarkdown} from '@/lib/runner-catalog';

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
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            {headers.map((value) => (
              <th key={value}>{value}</th>
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
                  <td key={`${values[0]}-${index}`}>
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
    </div>
  );
}

export const runnerCatalogMarkdown = renderRunnerCatalogMarkdown;
