import {defineInterModuleContract, defineInterModulePresentation} from '@shipfox/inter-module';
import {z} from 'zod';
import {ordersContract, widgetsContract} from '#test/fixtures.js';
import {InterModuleCompositionError, InterModuleTransportStateError} from './errors.js';
import {createInMemoryInterModuleTransport} from './transport.js';

function widgetsPresentation() {
  return defineInterModulePresentation(widgetsContract, {
    getWidget: ({id}) => ({id, name: 'Widget'}),
  });
}

describe('createInMemoryInterModuleTransport lifecycle', () => {
  it('seals a graph with a matching client and presentation', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);
    transport.register(widgetsPresentation());

    expect(() => transport.seal()).not.toThrow();
  });

  it('seals a graph with a presentation but no client for it', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.register(widgetsPresentation());

    expect(() => transport.seal()).not.toThrow();
  });

  it('rejects sealing when a client has no registered presentation', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);

    expect(() => transport.seal()).toThrow(InterModuleCompositionError);
  });

  it('rejects registering a second presentation for an already-registered module, without disturbing the first', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);
    transport.register(widgetsPresentation());

    expect(() => transport.register(widgetsPresentation())).toThrow(InterModuleCompositionError);
    expect(() => transport.seal()).not.toThrow();
  });

  it('rejects registering a presentation whose contract is a different object than the client used, without disturbing the client', () => {
    const duplicateContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        getWidget: {
          input: z.object({id: z.string()}),
          output: z.object({id: z.string(), name: z.string()}),
          errors: {'not-found': z.object({id: z.string()})},
        },
      },
    });

    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);

    expect(() =>
      transport.register(
        defineInterModulePresentation(duplicateContract, {
          getWidget: ({id}) => ({id, name: 'Widget'}),
        }),
      ),
    ).toThrow(InterModuleCompositionError);

    transport.register(widgetsPresentation());
    expect(() => transport.seal()).not.toThrow();
  });

  it('rejects creating a client whose contract does not match an already-registered presentation', () => {
    const duplicateContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        getWidget: {
          input: z.object({id: z.string()}),
          output: z.object({id: z.string(), name: z.string()}),
          errors: {'not-found': z.object({id: z.string()})},
        },
      },
    });

    const transport = createInMemoryInterModuleTransport();
    transport.register(widgetsPresentation());

    expect(() => transport.createClient(duplicateContract)).toThrow(InterModuleCompositionError);

    expect(() => transport.createClient(widgetsContract)).not.toThrow();
    expect(() => transport.seal()).not.toThrow();
  });

  it('rejects creating a second client for the same module with a mismatched contract object, without disturbing the first', () => {
    const duplicateContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        getWidget: {
          input: z.object({id: z.string()}),
          output: z.object({id: z.string(), name: z.string()}),
          errors: {'not-found': z.object({id: z.string()})},
        },
      },
    });

    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);

    expect(() => transport.createClient(duplicateContract)).toThrow(InterModuleCompositionError);

    transport.register(widgetsPresentation());
    expect(() => transport.seal()).not.toThrow();
  });

  it('allows multiple clients that reuse the exact same contract object', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);
    transport.createClient(widgetsContract);
    transport.register(widgetsPresentation());

    expect(() => transport.seal()).not.toThrow();
  });

  it('rejects registering a presentation missing a handler for a declared method', () => {
    const transport = createInMemoryInterModuleTransport();

    expect(() =>
      transport.register({
        contract: widgetsContract,
        handlers: {} as never,
      }),
    ).toThrow(InterModuleCompositionError);
  });

  it('rejects registering a presentation whose handler is truthy but not callable', () => {
    const transport = createInMemoryInterModuleTransport();

    expect(() =>
      transport.register({
        contract: widgetsContract,
        handlers: {getWidget: 'not a function'} as never,
      }),
    ).toThrow(InterModuleCompositionError);
  });

  it('is unaffected by mutating the presentation object after registering it', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(widgetsContract);
    const presentation = widgetsPresentation();
    transport.register(presentation);
    transport.seal();

    presentation.handlers.getWidget = () => {
      throw new Error('should never run: transport must not read this mutated handler');
    };

    await expect(client.getWidget({id: 'w-1'})).resolves.toEqual({id: 'w-1', name: 'Widget'});
  });

  it('recovers from a failed seal: fixing the graph and sealing again succeeds', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.createClient(widgetsContract);

    expect(() => transport.seal()).toThrow(InterModuleCompositionError);

    transport.register(widgetsPresentation());

    expect(() => transport.seal()).not.toThrow();
  });

  it('rejects creating a client after the transport is sealed', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.register(widgetsPresentation());
    transport.seal();

    expect(() => transport.createClient(widgetsContract)).toThrow(InterModuleTransportStateError);
  });

  it('rejects registering a presentation after the transport is sealed', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.register(widgetsPresentation());
    transport.seal();

    expect(() => transport.register(widgetsPresentation())).toThrow(InterModuleTransportStateError);
  });

  it('rejects sealing an already-sealed transport', () => {
    const transport = createInMemoryInterModuleTransport();
    transport.register(widgetsPresentation());
    transport.seal();

    expect(() => transport.seal()).toThrow(InterModuleTransportStateError);
  });

  it('rejects a call made before the transport is sealed', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(widgetsContract);
    transport.register(widgetsPresentation());

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow(InterModuleTransportStateError);
  });

  it('allows calls once the transport is sealed', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(widgetsContract);
    transport.register(widgetsPresentation());
    transport.seal();

    await expect(client.getWidget({id: 'w-1'})).resolves.toEqual({id: 'w-1', name: 'Widget'});
  });
});

describe('createInMemoryInterModuleTransport bidirectional graphs and isolation', () => {
  it('lets two modules call each other without a code import cycle', async () => {
    const transport = createInMemoryInterModuleTransport();
    const orders = transport.createClient(ordersContract);
    const widgets = transport.createClient(widgetsContract);

    transport.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: async ({id}) => {
          const {count} = await orders.getOrderCountForWidget({widgetId: id});
          return {id, name: `Widget with ${count} orders`};
        },
      }),
    );
    transport.register(
      defineInterModulePresentation(ordersContract, {
        getOrderCountForWidget: () => ({count: 3}),
      }),
    );

    transport.seal();

    await expect(widgets.getWidget({id: 'w-1'})).resolves.toEqual({
      id: 'w-1',
      name: 'Widget with 3 orders',
    });
  });

  it('keeps two transport instances fully isolated from one another', async () => {
    const transportA = createInMemoryInterModuleTransport();
    const clientA = transportA.createClient(widgetsContract);
    transportA.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: ({id}) => ({id, name: 'From transport A'}),
      }),
    );
    transportA.seal();

    const transportB = createInMemoryInterModuleTransport();
    const clientB = transportB.createClient(widgetsContract);
    transportB.register(
      defineInterModulePresentation(widgetsContract, {
        getWidget: ({id}) => ({id, name: 'From transport B'}),
      }),
    );
    transportB.seal();

    await expect(clientA.getWidget({id: 'w-1'})).resolves.toEqual({
      id: 'w-1',
      name: 'From transport A',
    });
    await expect(clientB.getWidget({id: 'w-1'})).resolves.toEqual({
      id: 'w-1',
      name: 'From transport B',
    });
  });

  it('does not expose a reset hook, singleton, or other process-global state', async () => {
    const module = await import('./transport.js');

    expect(Object.keys(module)).toEqual(['createInMemoryInterModuleTransport']);
  });
});
