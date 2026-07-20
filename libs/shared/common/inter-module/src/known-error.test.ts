import {z} from 'zod';
import {widgetsContract} from '#test/fixtures.js';
import {defineInterModuleContract} from './contract.js';
import {createInterModuleKnownError, isInterModuleKnownError} from './known-error.js';

const UNKNOWN_ERROR_CODE_MESSAGE = /Unknown inter-module error code/;
const RESHAPING_SCHEMA_MESSAGE = /does not keep its input and output shapes identical/;

describe('createInterModuleKnownError', () => {
  it('creates an error carrying the module, method, code, and parsed details', () => {
    const error = createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {
      id: 'w-1',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.module).toBe('widgets');
    expect(error.method).toBe('getWidget');
    expect(error.code).toBe('not-found');
    expect(error.details).toEqual({id: 'w-1'});
  });

  it('throws a plain error for an undeclared code', () => {
    expect(() =>
      // @ts-expect-error 'unknown-code' is not declared for getWidget
      createInterModuleKnownError(widgetsContract.methods.getWidget, 'unknown-code', {id: 'w-1'}),
    ).toThrow(UNKNOWN_ERROR_CODE_MESSAGE);
  });

  it('throws when details fail the code schema', () => {
    expect(() =>
      // @ts-expect-error details must include 'id'
      createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {}),
    ).toThrow();
  });

  it('does not mark the thrown error from an undeclared code as a known error', () => {
    let caught: unknown;
    try {
      // @ts-expect-error 'unknown-code' is not declared for getWidget
      createInterModuleKnownError(widgetsContract.methods.getWidget, 'unknown-code', {id: 'w-1'});
    } catch (error) {
      caught = error;
    }

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, caught)).toBe(false);
  });
});

describe('isInterModuleKnownError', () => {
  it('accepts an error minted for the same method contract', () => {
    const error = createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {
      id: 'w-1',
    });

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, error)).toBe(true);
  });

  it('rejects a plain Error with no marker', () => {
    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, new Error('boom'))).toBe(
      false,
    );
  });

  it('rejects non-error values', () => {
    expect(
      isInterModuleKnownError(widgetsContract.methods.getWidget, {
        code: 'not-found',
        details: {id: 'w-1'},
      }),
    ).toBe(false);
    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, undefined)).toBe(false);
  });

  it('rejects an error minted for a different method on the same contract', () => {
    const error = createInterModuleKnownError(widgetsContract.methods.createWidget, 'conflict', {
      name: 'Widget',
    });

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, error)).toBe(false);
  });

  it('accepts an error minted against a structurally identical contract from a duplicate package copy', () => {
    // Recognition is intentionally structural (module, method, code, and schema), not by
    // contract object reference: a duplicate installed copy of a producer's DTO package
    // would call `defineInterModuleContract` again and produce a different object, and a
    // known error minted under that copy must still narrow correctly for a caller holding
    // the other copy's contract object.
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
    const error = createInterModuleKnownError(duplicateContract.methods.getWidget, 'not-found', {
      id: 'w-1',
    });

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, error)).toBe(true);
  });

  it('rejects an error whose code schema shape differs from the checked contract', () => {
    const incompatibleContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        getWidget: {
          input: z.object({id: z.number()}),
          output: z.object({id: z.number(), name: z.string()}),
          errors: {'not-found': z.object({id: z.number()})},
        },
      },
    });
    const error = createInterModuleKnownError(incompatibleContract.methods.getWidget, 'not-found', {
      id: 42,
    });

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, error)).toBe(false);
  });

  it('rejects an error whose details were tampered with after minting', () => {
    const error = createInterModuleKnownError(widgetsContract.methods.getWidget, 'not-found', {
      id: 'w-1',
    });
    Object.assign(error, {details: {}});

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, error)).toBe(false);
  });

  it('rejects a forged object carrying the right fields but no marker', () => {
    const forged = Object.assign(new Error('not-found'), {
      module: 'widgets',
      method: 'getWidget',
      code: 'not-found',
      details: {id: 'w-1'},
    });

    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, forged)).toBe(false);
  });

  it('narrows details to the schema for the matched code', () => {
    const error: unknown = createInterModuleKnownError(
      widgetsContract.methods.getWidget,
      'not-found',
      {id: 'w-1'},
    );

    if (isInterModuleKnownError(widgetsContract.methods.getWidget, error)) {
      expect(error.code).toBe('not-found');
      expect(error.details.id).toBe('w-1');
    } else {
      throw new Error('expected a known error');
    }
  });

  it('exhaustively narrows every declared code in a switch, one method with two+ codes', () => {
    const renameContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        renameWidget: {
          input: z.object({id: z.string(), name: z.string()}),
          output: z.object({id: z.string(), name: z.string()}),
          errors: {
            'not-found': z.object({id: z.string()}),
            conflict: z.object({id: z.string(), name: z.string()}),
          },
        },
      },
    });

    function describeRejection(error: unknown): string {
      if (!isInterModuleKnownError(renameContract.methods.renameWidget, error)) return 'unknown';

      // Switching on the destructured code (not the `error.code` property access)
      // is what lets TypeScript narrow the default branch to `never`: see the
      // README's "Exhaustively switching on a known-error code" section.
      const {code} = error;
      switch (code) {
        case 'not-found':
          return `not-found:${error.details.id}`;
        case 'conflict':
          return `conflict:${error.details.name}`;
        default: {
          const exhaustive: never = code;
          throw new Error(`Unhandled known error code: ${exhaustive as string}`);
        }
      }
    }

    const notFound = createInterModuleKnownError(renameContract.methods.renameWidget, 'not-found', {
      id: 'w-1',
    });
    const conflict = createInterModuleKnownError(renameContract.methods.renameWidget, 'conflict', {
      id: 'w-1',
      name: 'Widget',
    });

    expect(describeRejection(notFound)).toBe('not-found:w-1');
    expect(describeRejection(conflict)).toBe('conflict:Widget');
    expect(describeRejection(new Error('boom'))).toBe('unknown');
  });

  it('rejects minting a known error whose code schema is a shape-changing transform', () => {
    // Enforced constraint, not just documentation: `isInterModuleKnownError`
    // re-validates `error.details` (the schema's own *output*) by re-parsing
    // it through that same schema. A shape-changing transform would silently
    // break that later re-validation, so `createInterModuleKnownError` catches
    // the violation immediately, at the point of misuse, instead of minting a
    // known error that mysteriously fails to narrow much later.
    const reshapingContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        getWidget: {
          input: z.object({id: z.string()}),
          output: z.object({id: z.string(), name: z.string()}),
          errors: {
            'not-found': z.object({id: z.string()}).transform((value) => ({widgetId: value.id})),
          },
        },
      },
    });

    expect(() =>
      createInterModuleKnownError(reshapingContract.methods.getWidget, 'not-found', {id: 'w-1'}),
    ).toThrow(RESHAPING_SCHEMA_MESSAGE);
  });

  it('never throws when the error code schema behaves asynchronously', () => {
    const asyncContract = defineInterModuleContract({
      module: 'widgets',
      methods: {
        getWidget: {
          input: z.object({id: z.string()}),
          output: z.object({id: z.string(), name: z.string()}),
          errors: {
            'not-found': z.object({id: z.string()}).refine(async () => true),
          },
        },
      },
    });
    const forged = Object.assign(new Error('forged'), {
      module: 'widgets',
      method: 'getWidget',
      code: 'not-found',
      details: {id: 'w-1'},
    });

    expect(() => isInterModuleKnownError(asyncContract.methods.getWidget, forged)).not.toThrow();
    expect(isInterModuleKnownError(asyncContract.methods.getWidget, forged)).toBe(false);
  });

  it('never throws when a marked error has throwing accessors', () => {
    const marker = Symbol.for('@shipfox/inter-module/known-error');
    const target = new Error('hostile');
    Object.defineProperty(target, marker, {value: true, enumerable: false});
    const hostile = new Proxy(target, {
      get(obj, prop) {
        if (prop === 'module' || prop === 'method' || prop === 'code' || prop === 'details') {
          throw new Error('secret: should never escape');
        }
        return Reflect.get(obj, prop);
      },
    });

    expect(() => isInterModuleKnownError(widgetsContract.methods.getWidget, hostile)).not.toThrow();
    expect(isInterModuleKnownError(widgetsContract.methods.getWidget, hostile)).toBe(false);
  });
});
