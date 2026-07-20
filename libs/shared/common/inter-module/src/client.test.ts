import {widgetsContract} from '#test/fixtures.js';
import {createInterModuleClient, type InterModuleDispatchCall} from './client.js';

describe('createInterModuleClient', () => {
  it('dispatches with the contract module name, the called method, and the given input', async () => {
    const calls: InterModuleDispatchCall[] = [];
    const client = createInterModuleClient(widgetsContract, (call) => {
      calls.push(call);
      return Promise.resolve({id: 'w-1', name: 'Widget'});
    });

    const result = await client.getWidget({id: 'w-1'});

    expect(calls).toEqual([
      {module: 'widgets', method: 'getWidget', input: {id: 'w-1'}, options: undefined},
    ]);
    expect(result).toEqual({id: 'w-1', name: 'Widget'});
  });

  it('forwards call options such as an AbortSignal to dispatch', async () => {
    const controller = new AbortController();
    const calls: InterModuleDispatchCall[] = [];
    const client = createInterModuleClient(widgetsContract, (call) => {
      calls.push(call);
      return Promise.resolve({id: 'w-1', name: 'Widget'});
    });

    await client.getWidget({id: 'w-1'}, {signal: controller.signal});

    expect(calls[0]?.options).toEqual({signal: controller.signal});
  });

  it('exposes one client method per contract method', () => {
    const client = createInterModuleClient(widgetsContract, () =>
      Promise.resolve({id: 'w-1', name: 'Widget'}),
    );

    expect(typeof client.getWidget).toBe('function');
    expect(typeof client.createWidget).toBe('function');
  });

  it('rejects when dispatch rejects', async () => {
    const client = createInterModuleClient(widgetsContract, () =>
      Promise.reject(new Error('dispatch failed')),
    );

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow('dispatch failed');
  });
});

// These never run; the @ts-expect-error directives fail the build if the type
// constraints ever stop holding, which is the real protection this file adds.
describe('createInterModuleClient type safety', () => {
  it('rejects calls with the wrong input shape or an unknown method', () => {
    const client = createInterModuleClient(widgetsContract, () =>
      Promise.resolve({id: 'w-1', name: 'Widget'}),
    );

    // @ts-expect-error 'id' must be a string
    void client.getWidget({id: 42});

    // @ts-expect-error 'renameWidget' is not a declared method
    void client.renameWidget;
  });
});
