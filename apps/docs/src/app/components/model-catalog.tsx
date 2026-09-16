import type {CatalogModel, ModelCatalog} from '@/lib/model-catalog';
import {formatModelCapabilities, formatModelPrice} from '@/lib/model-catalog';

const PRICE_COLUMNS = [
  ['Input / 1M tokens', 'input'],
  ['Cached input / 1M tokens', 'cached_input'],
  ['Cache write / 1M tokens', 'cache_write'],
  ['Output / 1M tokens', 'output'],
  ['Web search / 1K requests', 'web_search'],
] as const;

export function ModelCatalogTable({catalog}: {catalog: ModelCatalog}) {
  return (
    <div className="not-prose my-region overflow-x-auto">
      <table>
        <caption className="sr-only">Available Shipfox Cloud agent models and prices</caption>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Model ID</th>
            <th scope="col">Capabilities</th>
            {PRICE_COLUMNS.map(([label]) => (
              <th scope="col" key={label}>
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
    </div>
  );
}

function ModelRow({model}: {model: CatalogModel}) {
  return (
    <tr>
      <th scope="row">{model.label}</th>
      <td>
        <code>{model.id}</code>
      </td>
      <td>{formatModelCapabilities(model.capabilities)}</td>
      {PRICE_COLUMNS.map(([, key]) => (
        <td key={key}>{formatModelPrice(model.pricing[key])}</td>
      ))}
    </tr>
  );
}
