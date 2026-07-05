import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

const argosScreenshot = vi.fn();

class FakeElement {
  textContent: string | null;
  value?: string;
  private readonly attributes = new Map<string, string>();

  constructor(params: {
    text?: string | null;
    value?: string;
    attributes?: Record<string, string>;
  }) {
    this.textContent = params.text ?? null;
    if (params.value !== undefined) this.value = params.value;
    for (const [name, value] of Object.entries(params.attributes ?? {})) {
      this.attributes.set(name, value);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

class FakeLocator {
  constructor(
    private readonly elements: FakeElement[],
    private readonly failingIndexes = new Set<number>(),
    private readonly index?: number,
  ) {}

  count(): Promise<number> {
    return Promise.resolve(this.elements.length);
  }

  nth(index: number): FakeLocator {
    return new FakeLocator(this.elements, this.failingIndexes, index);
  }

  evaluate<T, A>(callback: (element: FakeElement, arg: A) => T, arg: A): Promise<T> {
    const index = this.index ?? 0;
    if (this.failingIndexes.has(index)) {
      return Promise.reject(new Error(`evaluate failed for ${index}`));
    }
    return Promise.resolve(callback(this.elements[index] as FakeElement, arg));
  }
}

describe('stableScreenshot', () => {
  beforeEach(() => {
    vi.resetModules();
    argosScreenshot.mockReset();
    argosScreenshot.mockResolvedValue(undefined);
    vi.doMock('@shipfox/playwright', () => ({
      argosScreenshot,
    }));
  });

  it('applies text, value, and attribute replacements then restores them', async () => {
    const page = {};
    const first = new FakeElement({
      text: 'raw-token',
      value: 'raw-value',
      attributes: {'data-token': 'raw'},
    });
    const second = new FakeElement({text: 'raw-second'});
    const locator = new FakeLocator([first, second]);
    const {stableScreenshot} = await import('./stable-screenshot.js');

    await stableScreenshot(page as never, 'normalized', [
      {
        locator: locator as never,
        text: 'stable-token',
        value: 'stable-value',
        attributes: {'data-token': 'stable', 'data-added': 'stable-added'},
      },
    ]);

    expect(argosScreenshot).toHaveBeenCalledWith(page, 'normalized');
    expect(first.textContent).toBe('raw-token');
    expect(first.value).toBe('raw-value');
    expect(first.getAttribute('data-token')).toBe('raw');
    expect(first.getAttribute('data-added')).toBeNull();
    expect(second.textContent).toBe('raw-second');
  });

  it('restores replacements when argosScreenshot fails', async () => {
    const error = new Error('argos failed');
    argosScreenshot.mockRejectedValueOnce(error);
    const element = new FakeElement({text: 'before'});
    const locator = new FakeLocator([element]);
    const {stableScreenshot} = await import('./stable-screenshot.js');

    const result = stableScreenshot({} as never, 'failure', [
      {locator: locator as never, text: 'during'},
    ]);

    await expect(result).rejects.toBe(error);
    expect(element.textContent).toBe('before');
  });

  it('restores completed replacements when a later replacement fails', async () => {
    const first = new FakeElement({text: 'first-before'});
    const second = new FakeElement({text: 'second-before'});
    const locator = new FakeLocator([first, second], new Set([1]));
    const {stableScreenshot} = await import('./stable-screenshot.js');

    const result = stableScreenshot({} as never, 'partial-failure', [
      {locator: locator as never, text: 'during'},
    ]);

    await expect(result).rejects.toThrow('evaluate failed for 1');
    expect(argosScreenshot).not.toHaveBeenCalled();
    expect(first.textContent).toBe('first-before');
    expect(second.textContent).toBe('second-before');
  });

  it('throws clearly when locator counts drift before restore', async () => {
    const elements = [new FakeElement({text: 'before'})];
    const locator = new FakeLocator(elements);
    argosScreenshot.mockImplementationOnce(() => {
      elements.push(new FakeElement({text: 'new'}));
    });
    const {stableScreenshot} = await import('./stable-screenshot.js');

    const result = stableScreenshot({} as never, 'drift', [
      {locator: locator as never, text: 'during'},
    ]);

    await expect(result).rejects.toThrow(
      'Cannot restore stable screenshot replacements: locator matched 2 elements after capture, but matched 1 before capture.',
    );
  });
});
