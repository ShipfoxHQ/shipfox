import {
  createInterModuleKnownError,
  defineInterModuleContract,
  defineInterModulePresentation,
  type InterModuleClient,
  type InterModuleContract,
  type InterModulePresentationHandlers,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {z} from 'zod';
import {widgetsContract} from '#test/fixtures.js';
import {createInMemoryInterModuleTransport} from './transport.js';

type WidgetsDef = typeof widgetsContract extends InterModuleContract<infer Def> ? Def : never;

function buildClient(
  handlers: InterModulePresentationHandlers<WidgetsDef>,
): InterModuleClient<WidgetsDef> {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(widgetsContract);
  transport.register(defineInterModulePresentation(widgetsContract, handlers));
  transport.seal();
  return client;
}

describe('in-memory inter-module transport: end-to-end call behavior', () => {
  it('resolves with the handler output', async () => {
    const client = buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});

    await expect(client.getWidget({id: 'w-1'})).resolves.toEqual({id: 'w-1', name: 'Widget'});
  });

  it('does not let the caller mutate the result by mutating its own input afterward', async () => {
    const client = buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});
    const input = {id: 'w-1'};

    const result = await client.getWidget(input);
    input.id = 'mutated';

    expect(result).toEqual({id: 'w-1', name: 'Widget'});
  });

  it('rejects invalid input without invoking the handler', async () => {
    let called = false;
    const client = buildClient({
      getWidget: ({id}) => {
        called = true;
        return {id, name: 'Widget'};
      },
    });

    // @ts-expect-error id must be a string
    await expect(client.getWidget({id: 42})).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('rejects raw non-JSON input', async () => {
    const client = buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});

    // @ts-expect-error a Date is not valid JSON input
    await expect(client.getWidget({id: new Date()})).rejects.toThrow();
  });

  it('rejects invalid handler output', async () => {
    const client = buildClient({
      // @ts-expect-error deliberately invalid output for the test
      getWidget: () => ({id: 'w-1'}),
    });

    await expect(client.getWidget({id: 'w-1'})).rejects.toThrow();
  });

  it('lets the caller narrow a declared known error by code and details', async () => {
    const client = buildClient({
      getWidget: ({id}) => {
        throw createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {id});
      },
    });

    const rejection = await client.getWidget({id: 'missing'}).catch((error: unknown) => error);

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)).toBe(true);
    if (isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)) {
      expect(rejection.code).toBe('not-found');
      expect(rejection.details).toEqual({id: 'missing'});
    }
  });

  it('treats a malformed known-error attempt as an opaque failure, not a known error', async () => {
    const otherContract = defineInterModuleContract({
      module: 'other',
      methods: {fail: {input: z.object({}), output: z.object({}), errors: {oops: z.object({})}}},
    });
    const client = buildClient({
      getWidget: () => {
        throw createInterModuleKnownError(otherContract.methods.fail, 'oops', {});
      },
    });

    const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)).toBe(false);
  });

  it('never leaks an undeclared handler exception message to the caller', async () => {
    const secretMessage = 'super secret internal detail';
    const client = buildClient({
      getWidget: () => {
        throw new Error(secretMessage);
      },
    });

    const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

    expect((rejection as Error).message).not.toContain(secretMessage);
  });

  it('rejects a pre-aborted call with the signal reason', async () => {
    const client = buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);

    await expect(client.getWidget({id: 'w-1'}, {signal: controller.signal})).rejects.toBe(reason);
  });

  it('rejects promptly when the signal aborts while the handler is in flight', async () => {
    let releaseHandler: (() => void) | undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const client = buildClient({
      getWidget: async ({id}) => {
        await handlerGate;
        return {id, name: 'Widget'};
      },
    });
    const controller = new AbortController();

    const callPromise = client.getWidget({id: 'w-1'}, {signal: controller.signal});
    controller.abort(new Error('aborted mid-flight'));

    await expect(callPromise).rejects.toThrow();
    releaseHandler?.();
  });
});
