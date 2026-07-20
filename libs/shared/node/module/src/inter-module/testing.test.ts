import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {ordersContract, widgetsContract} from '#test/fixtures.js';
import {createFakeInterModuleClients} from './testing.js';

describe('createFakeInterModuleClients', () => {
  it('builds one working client per named fake presentation', async () => {
    const clients = createFakeInterModuleClients({
      widgets: defineInterModulePresentation(widgetsContract, {
        getWidget: ({id}) => ({id, name: 'Fake widget'}),
      }),
    });

    await expect(clients.widgets.getWidget({id: 'w-1'})).resolves.toEqual({
      id: 'w-1',
      name: 'Fake widget',
    });
  });

  it('wires multiple named fakes so they can call each other', async () => {
    // `ordersClient` gets an explicit type so the `widgets` handler below can close
    // over it without forcing TypeScript to infer `clients`'s type from an
    // initializer that references `clients` itself.
    let ordersClient: {
      getOrderCountForWidget: (input: {widgetId: string}) => Promise<{count: number}>;
    };

    const clients = createFakeInterModuleClients({
      widgets: defineInterModulePresentation(widgetsContract, {
        getWidget: async ({id}) => {
          const {count} = await ordersClient.getOrderCountForWidget({widgetId: id});
          return {id, name: `Widget with ${count} orders`};
        },
      }),
      orders: defineInterModulePresentation(ordersContract, {
        getOrderCountForWidget: () => ({count: 2}),
      }),
    });
    ordersClient = clients.orders;

    await expect(clients.widgets.getWidget({id: 'w-1'})).resolves.toEqual({
      id: 'w-1',
      name: 'Widget with 2 orders',
    });
  });

  it('still runs input and output validation against the declared contract', async () => {
    const clients = createFakeInterModuleClients({
      widgets: defineInterModulePresentation(widgetsContract, {
        getWidget: ({id}) => ({id, name: 'Fake widget'}),
      }),
    });

    // @ts-expect-error id must be a string
    await expect(clients.widgets.getWidget({id: 42})).rejects.toThrow();
  });

  it('lets a fake handler reject with a real known error', async () => {
    const clients = createFakeInterModuleClients({
      widgets: defineInterModulePresentation(widgetsContract, {
        getWidget: ({id}) => {
          throw createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {id});
        },
      }),
    });

    const rejection = await clients.widgets
      .getWidget({id: 'missing'})
      .catch((error: unknown) => error);

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)).toBe(true);
  });

  it('gives each call an isolated transport: two fakes for the same contract never share state', async () => {
    let firstCallCount = 0;
    let secondCallCount = 0;

    const first = createFakeInterModuleClients({
      widgets: defineInterModulePresentation(widgetsContract, {
        getWidget: ({id}) => {
          firstCallCount++;
          return {id, name: 'First'};
        },
      }),
    });
    const second = createFakeInterModuleClients({
      widgets: defineInterModulePresentation(widgetsContract, {
        getWidget: ({id}) => {
          secondCallCount++;
          return {id, name: 'Second'};
        },
      }),
    });

    await first.widgets.getWidget({id: 'w-1'});

    expect(firstCallCount).toBe(1);
    expect(secondCallCount).toBe(0);

    await second.widgets.getWidget({id: 'w-1'});

    expect(firstCallCount).toBe(1);
    expect(secondCallCount).toBe(1);
  });

  it('is not coupled to Vitest: nothing here reaches for a Vitest-only global', async () => {
    const module = await import('./testing.js');

    expect(Object.keys(module)).toEqual(['createFakeInterModuleClients']);
  });
});
