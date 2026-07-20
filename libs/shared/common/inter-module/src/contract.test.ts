import {z} from 'zod';
import {widgetsContract} from '#test/fixtures.js';
import {defineInterModuleContract} from './contract.js';

const KEBAB_CASE_MESSAGE = /kebab-case/;

describe('defineInterModuleContract', () => {
  it('carries the module name on the contract and on every method', () => {
    expect(widgetsContract.module).toBe('widgets');
    expect(widgetsContract.methods.getWidget.module).toBe('widgets');
    expect(widgetsContract.methods.createWidget.module).toBe('widgets');
  });

  it('names each method contract after its own key', () => {
    expect(widgetsContract.methods.getWidget.method).toBe('getWidget');
    expect(widgetsContract.methods.createWidget.method).toBe('createWidget');
  });

  it('carries the exact input, output, and error schemas through', () => {
    expect(widgetsContract.methods.getWidget.input.safeParse({id: 'w-1'}).success).toBe(true);
    expect(
      widgetsContract.methods.getWidget.output.safeParse({id: 'w-1', name: 'Widget'}).success,
    ).toBe(true);
    expect(
      widgetsContract.methods.getWidget.errors['not-found']?.safeParse({id: 'w-1'}).success,
    ).toBe(true);
  });

  it('defaults a method with no declared errors to an empty error map', () => {
    const contract = defineInterModuleContract({
      module: 'plain',
      methods: {
        ping: {input: z.object({}), output: z.object({})},
      },
    });

    expect(contract.methods.ping.errors).toEqual({});
  });

  it('produces distinct method-contract objects across two calls with the same shape', () => {
    const first = defineInterModuleContract({
      module: 'widgets',
      methods: {getWidget: {input: z.object({id: z.string()}), output: z.object({id: z.string()})}},
    });
    const second = defineInterModuleContract({
      module: 'widgets',
      methods: {getWidget: {input: z.object({id: z.string()}), output: z.object({id: z.string()})}},
    });

    expect(first).not.toBe(second);
    expect(first.methods.getWidget).not.toBe(second.methods.getWidget);
  });

  it('freezes the contract and its method entries', () => {
    expect(Object.isFrozen(widgetsContract)).toBe(true);
    expect(Object.isFrozen(widgetsContract.methods.getWidget)).toBe(true);
    expect(Object.isFrozen(widgetsContract.methods.getWidget.errors)).toBe(true);
  });

  it.each([
    'not-found',
    'already-in-progress',
    'a',
    'a1-b2',
  ])('accepts the kebab-case error code %s', (code) => {
    expect(() =>
      defineInterModuleContract({
        module: 'widgets',
        methods: {
          getWidget: {input: z.object({}), output: z.object({}), errors: {[code]: z.object({})}},
        },
      }),
    ).not.toThrow();
  });

  it.each([
    'NotFound',
    'not_found',
    'notFound',
    '-not-found',
    'not-found-',
    'not--found',
    '',
  ])('rejects the non-kebab-case error code %s', (code) => {
    expect(() =>
      defineInterModuleContract({
        module: 'widgets',
        methods: {
          getWidget: {input: z.object({}), output: z.object({}), errors: {[code]: z.object({})}},
        },
      }),
    ).toThrow(KEBAB_CASE_MESSAGE);
  });
});

// These never run; the @ts-expect-error directives fail the build if the type
// constraints ever stop holding, which is the real protection this file adds.
describe('defineInterModuleContract type safety', () => {
  it('infers input/output per method and rejects unknown methods', () => {
    expect(widgetsContract.methods.getWidget.input.safeParse({id: 'w-1'}).success).toBe(true);

    // @ts-expect-error 'renameWidget' is not a declared method
    void widgetsContract.methods.renameWidget;
  });
});
