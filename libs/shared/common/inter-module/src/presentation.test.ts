import {widgetsContract} from '#test/fixtures.js';
import {createInterModuleKnownError} from './known-error.js';
import {defineInterModulePresentation} from './presentation.js';

describe('defineInterModulePresentation', () => {
  it('carries the exact contract object given to it', () => {
    const presentation = defineInterModulePresentation(widgetsContract, {
      getWidget: async ({id}) => ({id, name: 'Widget'}),
      createWidget: async ({name}) => ({id: 'w-1', name}),
    });

    expect(presentation.contract).toBe(widgetsContract);
  });

  it('passes the handler context signal through to the handler', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const presentation = defineInterModulePresentation(widgetsContract, {
      getWidget: ({id}, context) => {
        seenSignal = context.signal;
        return {id, name: 'Widget'};
      },
      createWidget: async ({name}) => ({id: 'w-1', name}),
    });

    await presentation.handlers.getWidget({id: 'w-1'}, {signal: controller.signal});

    expect(seenSignal).toBe(controller.signal);
  });

  it('lets a handler throw a known error for its own method', () => {
    const presentation = defineInterModulePresentation(widgetsContract, {
      getWidget: () => {
        throw createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {
          id: 'missing',
        });
      },
      createWidget: async ({name}) => ({id: 'w-1', name}),
    });

    const controller = new AbortController();
    expect(() =>
      presentation.handlers.getWidget({id: 'missing'}, {signal: controller.signal}),
    ).toThrow();
  });
});

// These never run; the @ts-expect-error directives fail the build if the type
// constraints ever stop holding, which is the real protection this file adds.
describe('defineInterModulePresentation type safety', () => {
  it('rejects a presentation missing a handler for a declared method', () => {
    // @ts-expect-error 'createWidget' handler is missing
    defineInterModulePresentation(widgetsContract, {
      getWidget: async ({id}) => ({id, name: 'Widget'}),
    });
  });

  it('rejects a handler returning the wrong output shape', () => {
    defineInterModulePresentation(widgetsContract, {
      // @ts-expect-error output must include 'name'
      getWidget: async ({id}) => ({id}),
      createWidget: async ({name}) => ({id: 'w-1', name}),
    });
  });
});
