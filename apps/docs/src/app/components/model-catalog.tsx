// biome-ignore-all lint/a11y/noRedundantRoles: the model catalog region keeps an explicit role for the public accessibility contract.
// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the model catalog region is intentionally keyboard focusable.

import type {CatalogModel, ModelCatalog} from '@/lib/model-catalog';
import {formatModelPrice} from '@/lib/model-catalog';

const TOKEN_PRICE_COLUMNS = [
  ['Input', 'input'],
  ['Cached', 'cached_input'],
  ['Write', 'cache_write'],
  ['Output', 'output'],
] as const;

export function ModelCatalogTable({catalog}: {catalog: ModelCatalog}) {
  return (
    <div className="not-prose my-region relative left-1/2 w-[min(1100px,calc(100vw-var(--fd-sidebar-width,0px)-var(--fd-toc-width,0px)-48px))] -translate-x-1/2">
      <section
        aria-label="Model catalog"
        className="overflow-x-auto rounded-lg border border-fd-border bg-fd-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
        role="region"
        tabIndex={0}
      >
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-sm">
          <caption className="sr-only">Available Shipfox Cloud agent models and prices</caption>
          <thead className="bg-fd-muted text-xs text-fd-muted-foreground">
            <tr>
              <th
                className="sticky left-0 z-20 min-w-[200px] border-e border-b border-fd-border bg-fd-muted px-row py-row align-bottom font-medium text-fd-foreground"
                rowSpan={2}
                scope="col"
              >
                Model
              </th>
              <th
                className="min-w-[220px] border-e border-b border-fd-border px-row py-row align-bottom font-medium text-fd-foreground"
                rowSpan={2}
                scope="col"
              >
                Limits and capabilities
              </th>
              <th
                className="border-b border-fd-border px-row py-row text-center font-medium text-fd-foreground"
                colSpan={TOKEN_PRICE_COLUMNS.length}
                scope="colgroup"
              >
                Token pricing
                <span className="ms-inline font-normal text-fd-muted-foreground">
                  per 1M tokens
                </span>
              </th>
              <th
                className="min-w-[112px] border-s border-b border-fd-border px-row py-row text-right align-bottom font-medium text-fd-foreground"
                rowSpan={2}
                scope="col"
              >
                <span className="block">Web search</span>
                <span className="block font-normal text-fd-muted-foreground">per 1K requests</span>
              </th>
            </tr>
            <tr>
              {TOKEN_PRICE_COLUMNS.map(([label]) => (
                <th
                  className="min-w-[96px] border-b border-fd-border px-row py-row text-right font-medium text-fd-foreground"
                  scope="col"
                  key={label}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.models.map((model) => (
              <ModelRow key={model.id} model={model} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function ModelRow({model}: {model: CatalogModel}) {
  const featureLabels = [
    ...(model.capabilities.image_input ? ['Image input'] : []),
    ...(model.capabilities.reasoning ? ['Reasoning'] : []),
  ];

  return (
    <tr className="[&>*]:border-b [&>*]:border-fd-border [&:last-child>*]:border-b-0">
      <th
        className="sticky left-0 z-10 border-e bg-fd-card px-row py-row align-top font-medium text-fd-foreground"
        scope="row"
      >
        <span className="grid gap-tight">
          <span>{model.label}</span>
          <code className="block whitespace-nowrap font-mono text-xs font-normal text-fd-muted-foreground">
            {model.id}
          </code>
        </span>
      </th>
      <td className="border-e px-row py-row align-top">
        <div className="grid gap-inline">
          <dl className="grid min-w-[188px] gap-tight">
            <div className="flex items-baseline justify-between gap-inline">
              <dt className="text-fd-muted-foreground">Context</dt>
              <dd className="whitespace-nowrap font-mono text-fd-foreground">
                {model.capabilities.context_window_tokens.toLocaleString('en-US')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-inline">
              <dt className="text-fd-muted-foreground">Max output</dt>
              <dd className="whitespace-nowrap font-mono text-fd-foreground">
                {model.capabilities.max_output_tokens.toLocaleString('en-US')}
              </dd>
            </div>
          </dl>
          {featureLabels.length > 0 ? (
            <ul className="flex flex-wrap gap-tight" aria-label="Features">
              {featureLabels.map((label) => (
                <li
                  className="rounded-md border border-fd-border bg-fd-muted px-tight text-xs font-medium text-fd-muted-foreground"
                  key={label}
                >
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </td>
      {TOKEN_PRICE_COLUMNS.map(([, key]) => (
        <td className="whitespace-nowrap px-row py-row text-right align-middle font-mono" key={key}>
          {formatModelPrice(model.pricing[key])}
        </td>
      ))}
      <td className="whitespace-nowrap border-s px-row py-row text-right align-middle font-mono">
        {formatModelPrice(model.pricing.web_search)}
      </td>
    </tr>
  );
}
