import {defineInterModulePresentation} from '@shipfox/inter-module';
import {ordersContract, widgetsContract} from '#test/fixtures.js';
import type {ShipfoxModule} from '../types.js';
import {registerInterModulePresentations} from './module-integration.js';
import {createInMemoryInterModuleTransport} from './transport.js';

describe('registerInterModulePresentations', () => {
  it('registers every declared presentation across all modules', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);
    transport.createClient(ordersContract);

    const modules: ShipfoxModule[] = [
      {
        name: 'widgets',
        interModulePresentations: [
          defineInterModulePresentation(widgetsContract, {
            getWidget: ({id}) => ({id, name: 'Widget'}),
          }),
        ],
      },
      {
        name: 'orders',
        interModulePresentations: [
          defineInterModulePresentation(ordersContract, {
            getOrderCountForWidget: () => ({count: 1}),
          }),
        ],
      },
    ];

    registerInterModulePresentations({transport, modules});

    expect(() => transport.seal()).not.toThrow();
  });

  it('skips modules that declare no inter-module presentations', () => {
    const transport = createInMemoryInterModuleTransport();

    const modules: ShipfoxModule[] = [{name: 'triggers'}];

    expect(() => registerInterModulePresentations({transport, modules})).not.toThrow();
    expect(() => transport.seal()).not.toThrow();
  });

  it('lets the transport reject a module missing a required presentation', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);

    const modules: ShipfoxModule[] = [{name: 'triggers'}];

    registerInterModulePresentations({transport, modules});

    expect(() => transport.seal()).toThrow();
  });
});
