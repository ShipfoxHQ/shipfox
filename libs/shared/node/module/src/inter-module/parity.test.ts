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
import {createHttpInterModuleClient, startHttpInterModuleServer} from '#test/http-transport.js';
import {createInMemoryInterModuleTransport} from './transport.js';

type WidgetsDef = typeof widgetsContract extends InterModuleContract<infer Def> ? Def : never;

interface Harness {
  client: InterModuleClient<WidgetsDef>;
  teardown: () => Promise<void>;
}

type ClientFactory = (handlers: InterModulePresentationHandlers<WidgetsDef>) => Promise<Harness>;

function buildInMemoryHarness(
  handlers: InterModulePresentationHandlers<WidgetsDef>,
): Promise<Harness> {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(widgetsContract);
  transport.register(defineInterModulePresentation(widgetsContract, handlers));
  transport.seal();
  return Promise.resolve({client, teardown: () => Promise.resolve()});
}

async function buildHttpHarness(
  handlers: InterModulePresentationHandlers<WidgetsDef>,
): Promise<Harness> {
  const server = await startHttpInterModuleServer({
    presentations: [defineInterModulePresentation(widgetsContract, handlers)],
  });
  const client = createHttpInterModuleClient(widgetsContract, {baseUrl: server.baseUrl});
  return {client, teardown: server.close};
}

function runSharedInterModuleSuite(transportName: string, buildClient: ClientFactory): void {
  describe(`inter-module transport parity: ${transportName}`, () => {
    it('resolves with the handler output', async () => {
      const {client, teardown} = await buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});
      try {
        await expect(client.getWidget({id: 'w-1'})).resolves.toEqual({id: 'w-1', name: 'Widget'});
      } finally {
        await teardown();
      }
    });

    it('does not let the caller mutate the result by mutating its own input afterward', async () => {
      const {client, teardown} = await buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});
      try {
        const input = {id: 'w-1'};
        const result = await client.getWidget(input);
        input.id = 'mutated';

        expect(result).toEqual({id: 'w-1', name: 'Widget'});
      } finally {
        await teardown();
      }
    });

    it('rejects invalid input without invoking the handler', async () => {
      let called = false;
      const {client, teardown} = await buildClient({
        getWidget: ({id}) => {
          called = true;
          return {id, name: 'Widget'};
        },
      });
      try {
        // @ts-expect-error id must be a string
        await expect(client.getWidget({id: 42})).rejects.toThrow();
        expect(called).toBe(false);
      } finally {
        await teardown();
      }
    });

    it('rejects raw non-JSON input', async () => {
      const {client, teardown} = await buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});
      try {
        // @ts-expect-error a Date is not valid JSON input
        await expect(client.getWidget({id: new Date()})).rejects.toThrow();
      } finally {
        await teardown();
      }
    });

    it('rejects invalid handler output', async () => {
      const {client, teardown} = await buildClient({
        // @ts-expect-error deliberately invalid output for the test
        getWidget: () => ({id: 'w-1'}),
      });
      try {
        await expect(client.getWidget({id: 'w-1'})).rejects.toThrow();
      } finally {
        await teardown();
      }
    });

    it('lets the caller narrow a declared known error by code and details', async () => {
      const {client, teardown} = await buildClient({
        getWidget: ({id}) => {
          throw createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {id});
        },
      });
      try {
        const rejection = await client.getWidget({id: 'missing'}).catch((error: unknown) => error);

        expect(isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)).toBe(true);
        if (isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)) {
          expect(rejection.code).toBe('not-found');
          expect(rejection.details).toEqual({id: 'missing'});
        }
      } finally {
        await teardown();
      }
    });

    it('treats a malformed known-error attempt as an opaque failure, not a known error', async () => {
      const otherContract = defineInterModuleContract({
        module: 'other',
        methods: {fail: {input: z.object({}), output: z.object({}), errors: {oops: z.object({})}}},
      });
      const {client, teardown} = await buildClient({
        getWidget: () => {
          throw createInterModuleKnownError(otherContract.methods.fail, 'oops', {});
        },
      });
      try {
        const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

        expect(isInterModuleKnownError(widgetsContract.methods.getWidget, rejection)).toBe(false);
      } finally {
        await teardown();
      }
    });

    it('never leaks an undeclared handler exception message to the caller', async () => {
      const secretMessage = 'super secret internal detail';
      const {client, teardown} = await buildClient({
        getWidget: () => {
          throw new Error(secretMessage);
        },
      });
      try {
        const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

        expect((rejection as Error).message).not.toContain(secretMessage);
      } finally {
        await teardown();
      }
    });

    it('rejects a pre-aborted call with the signal reason', async () => {
      const {client, teardown} = await buildClient({getWidget: ({id}) => ({id, name: 'Widget'})});
      try {
        const controller = new AbortController();
        const reason = new Error('already aborted');
        controller.abort(reason);

        await expect(client.getWidget({id: 'w-1'}, {signal: controller.signal})).rejects.toBe(
          reason,
        );
      } finally {
        await teardown();
      }
    });

    it('rejects promptly when the signal aborts while the handler is in flight', async () => {
      let releaseHandler: (() => void) | undefined;
      const handlerGate = new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      const {client, teardown} = await buildClient({
        getWidget: async ({id}) => {
          await handlerGate;
          return {id, name: 'Widget'};
        },
      });
      try {
        const controller = new AbortController();
        const callPromise = client.getWidget({id: 'w-1'}, {signal: controller.signal});
        controller.abort(new Error('aborted mid-flight'));

        await expect(callPromise).rejects.toThrow();
      } finally {
        releaseHandler?.();
        await teardown();
      }
    });
  });
}

runSharedInterModuleSuite('in-memory', buildInMemoryHarness);
runSharedInterModuleSuite('http', buildHttpHarness);
