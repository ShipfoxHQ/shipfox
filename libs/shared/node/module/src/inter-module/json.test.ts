import {isJsonSafeValue} from './json.js';

describe('isJsonSafeValue', () => {
  describe('accepted shapes', () => {
    it.each([
      ['null', null],
      ['a boolean', true],
      ['a finite number', 42],
      ['zero', 0],
      ['a negative number', -1.5],
      ['a string', 'hello'],
      ['an empty string', ''],
      ['an empty array', []],
      ['an empty object', {}],
      ['a dense array of primitives', [1, 'two', false, null]],
      ['a nested plain object', {a: {b: {c: 1}}}],
      ['an array of objects', [{id: 1}, {id: 2}]],
      ['a null-prototype object', Object.assign(Object.create(null), {a: 1})],
    ])('accepts %s', (_name, value) => {
      expect(isJsonSafeValue(value)).toBe(true);
    });

    it('accepts the same object reachable twice through two different branches (an alias, not a cycle)', () => {
      const shared = {x: 1};
      const value = {a: shared, b: shared};

      expect(isJsonSafeValue(value)).toBe(true);
    });

    it('accepts the same array reachable twice through two different branches', () => {
      const shared = [1, 2];
      const value = [shared, shared];

      expect(isJsonSafeValue(value)).toBe(true);
    });

    it('accepts an array with a non-enumerable index, unlike a plain object', () => {
      // Unlike an object, `JSON.stringify` always serializes array indices
      // 0..length-1 regardless of enumerability, so this loses no data.
      const value = [1, 2, 3];
      Object.defineProperty(value, 1, {value: 99, enumerable: false, configurable: true});

      expect(isJsonSafeValue(value)).toBe(true);
    });
  });

  describe('rejected shapes', () => {
    it.each([
      ['undefined', undefined],
      ['a bigint', BigInt(1)],
      ['a symbol', Symbol('x')],
      ['a function', () => undefined],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['a Date', new Date('2026-01-01T00:00:00Z')],
      ['a Map', new Map()],
      ['a Set', new Set()],
      ['a class instance', new (class Widget {})()],
      ['an object with a symbol key', {[Symbol('k')]: 1}],
    ])('rejects %s', (_name, value) => {
      expect(isJsonSafeValue(value)).toBe(false);
    });

    it('rejects undefined nested in an object', () => {
      expect(isJsonSafeValue({a: undefined})).toBe(false);
    });

    it('rejects a sparse array', () => {
      // biome-ignore lint/suspicious/noSparseArray: constructing a real sparse array on purpose
      const sparse = [1, , 3];
      expect(isJsonSafeValue(sparse)).toBe(false);
    });

    it('rejects an array with an extra non-index own property', () => {
      const value: number[] & {extra?: string} = [1, 2, 3];
      value.extra = 'nope';

      expect(isJsonSafeValue(value)).toBe(false);
    });

    it('rejects an object with a getter accessor', () => {
      const value: {a?: number} = {};
      Object.defineProperty(value, 'a', {get: () => 1, enumerable: true, configurable: true});

      expect(isJsonSafeValue(value)).toBe(false);
    });

    it('rejects an object with a non-enumerable data property', () => {
      // JSON.stringify silently drops a non-enumerable own property, so a value
      // this guard calls safe must not lose data across the JSON copy step.
      const value: {a?: number} = {};
      Object.defineProperty(value, 'a', {value: 1, enumerable: false, configurable: true});

      expect(isJsonSafeValue(value)).toBe(false);
    });

    it('rejects a self-referencing object (a true cycle)', () => {
      const value: Record<string, unknown> = {a: 1};
      value.self = value;

      expect(isJsonSafeValue(value)).toBe(false);
    });

    it('rejects a self-referencing array (a true cycle)', () => {
      const value: unknown[] = [1, 2];
      value.push(value);

      expect(isJsonSafeValue(value)).toBe(false);
    });

    it('rejects a cycle nested two levels deep', () => {
      const inner: Record<string, unknown> = {};
      const outer = {inner};
      inner.outer = outer;

      expect(isJsonSafeValue(outer)).toBe(false);
    });

    it('rejects a value nested inside an otherwise valid object', () => {
      expect(isJsonSafeValue({a: 1, b: {c: new Date()}})).toBe(false);
    });

    it('rejects a Proxy whose ownKeys trap throws, without leaking the thrown error', () => {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('secret: should never escape');
          },
        },
      );

      expect(() => isJsonSafeValue(hostile)).not.toThrow();
      expect(isJsonSafeValue(hostile)).toBe(false);
    });

    it('rejects a Proxy whose getPrototypeOf trap throws, without leaking the thrown error', () => {
      const hostile = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('secret: should never escape');
          },
        },
      );

      expect(() => isJsonSafeValue(hostile)).not.toThrow();
      expect(isJsonSafeValue(hostile)).toBe(false);
    });

    it('rejects a Proxy whose get trap throws, without leaking the thrown error', () => {
      const hostile = new Proxy(
        {a: 1},
        {
          get() {
            throw new Error('secret: should never escape');
          },
        },
      );

      expect(() => isJsonSafeValue(hostile)).not.toThrow();
      expect(isJsonSafeValue(hostile)).toBe(false);
    });
  });
});
