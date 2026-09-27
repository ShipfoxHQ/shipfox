import {defineAction, isActionDefinition} from '#define-action.js';

describe('defineAction', () => {
  it('returns a definition that carries the handler', () => {
    const handler = () => ({path: 'a.md'});

    const definition = defineAction(handler);

    expect(definition.handler).toBe(handler);
    expect(isActionDefinition(definition)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it('rejects a value that is not a function', () => {
    const define = () => defineAction('index.ts' as never);

    expect(define).toThrow('defineAction expects the action handler function.');
  });
});

describe('isActionDefinition', () => {
  it.each([
    ['a bare handler', async () => undefined],
    ['an object with a handler', {handler: async () => undefined}],
    ['null', null],
    ['a module namespace without a default', {}],
  ])('rejects %s', (_label, value) => {
    expect(isActionDefinition(value)).toBe(false);
  });
});
