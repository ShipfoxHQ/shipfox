import {argosScreenshot, type Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type ElementHandle = NonNullable<Awaited<ReturnType<Locator['elementHandle']>>>;

interface MutableElement {
  textContent: string | null;
  value?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface StableReplacement {
  locator: Locator;
  text?: string;
  attributes?: Record<string, string>;
  value?: string;
}

export interface StableScreenshotOptions {
  replacements?: StableReplacement[];
  textReplacements?: ReadonlyArray<readonly [string, string]>;
  hideToaster?: boolean;
}

interface ElementSnapshot {
  handle: ElementHandle;
  text?: string | null;
  value?: string;
  attributes: Record<string, string | null>;
}

interface LocatorSnapshot {
  elements: ElementSnapshot[];
}

export async function stableScreenshot(
  page: Page,
  name: string,
  replacementsOrOptions: StableReplacement[] | StableScreenshotOptions = [],
): Promise<void> {
  const options = Array.isArray(replacementsOrOptions)
    ? {replacements: replacementsOrOptions}
    : replacementsOrOptions;
  const snapshots: LocatorSnapshot[] = [];
  let pageWideReplacementsApplied = false;
  let operationError: unknown;

  try {
    if (options.textReplacements || options.hideToaster) {
      await applyPageWideReplacements(page, {
        textReplacements: options.textReplacements ?? [],
        hideToaster: options.hideToaster ?? false,
      });
      pageWideReplacementsApplied = true;
    }
    await applyReplacements(options.replacements ?? [], snapshots);
    await argosScreenshot(page, name);
  } catch (error) {
    operationError = error;
  }

  let restoreError: unknown;
  try {
    if (snapshots.length > 0) await restoreSnapshots(snapshots);
  } catch (error) {
    restoreError = error;
  }
  if (pageWideReplacementsApplied) await restorePageWideReplacements(page);
  if (restoreError) throw restoreError;
  if (operationError) throw operationError;
}

async function applyPageWideReplacements(
  page: Page,
  options: {
    textReplacements: ReadonlyArray<readonly [string, string]>;
    hideToaster: boolean;
  },
): Promise<void> {
  await page.evaluate((input) => {
    type RestoreEntry =
      | {kind: 'attribute'; target: Element; attribute: string; value: string}
      | {kind: 'text'; target: Text; value: string}
      | {kind: 'value'; target: HTMLInputElement | HTMLTextAreaElement; value: string};
    const visualWindow = window as Window & {
      __shipfoxVisualRestore?: RestoreEntry[];
      __shipfoxToasterDisplay?: string;
    };
    const restoreEntries: RestoreEntry[] = [];

    if (input.hideToaster) {
      const toaster = document.querySelector('[data-sonner-toaster]');
      if (toaster instanceof HTMLElement) {
        visualWindow.__shipfoxToasterDisplay = toaster.style.display;
        toaster.style.display = 'none';
      }
    }

    const replaceValue = (value: string): string =>
      input.textReplacements.reduce(
        (current, [source, replacement]) => current.split(source).join(replacement),
        value,
      );

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const nextValue = replaceValue(textNode.data);
      if (nextValue !== textNode.data) {
        restoreEntries.push({kind: 'text', target: textNode, value: textNode.data});
        textNode.data = nextValue;
      }
      node = walker.nextNode();
    }

    for (const element of document.querySelectorAll('input, textarea')) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const nextValue = replaceValue(element.value);
        if (nextValue !== element.value) {
          restoreEntries.push({kind: 'value', target: element, value: element.value});
          element.value = nextValue;
        }
      }
    }

    for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
      for (const attribute of ['aria-label', 'placeholder', 'title']) {
        const value = element.getAttribute(attribute);
        if (value == null) continue;
        const nextValue = replaceValue(value);
        if (nextValue !== value) {
          restoreEntries.push({kind: 'attribute', target: element, attribute, value});
          element.setAttribute(attribute, nextValue);
        }
      }
    }

    visualWindow.__shipfoxVisualRestore = restoreEntries;
  }, options);
}

async function restorePageWideReplacements(page: Page): Promise<void> {
  await page.evaluate(() => {
    type RestoreEntry =
      | {kind: 'attribute'; target: Element; attribute: string; value: string}
      | {kind: 'text'; target: Text; value: string}
      | {kind: 'value'; target: HTMLInputElement | HTMLTextAreaElement; value: string};
    const visualWindow = window as Window & {
      __shipfoxVisualRestore?: RestoreEntry[];
      __shipfoxToasterDisplay?: string;
    };
    const restoreEntries = visualWindow.__shipfoxVisualRestore ?? [];

    for (const entry of restoreEntries.reverse()) {
      if (entry.kind === 'text') {
        entry.target.data = entry.value;
      } else if (entry.kind === 'value') {
        entry.target.value = entry.value;
      } else {
        entry.target.setAttribute(entry.attribute, entry.value);
      }
    }

    const toaster = document.querySelector('[data-sonner-toaster]');
    if (toaster instanceof HTMLElement && visualWindow.__shipfoxToasterDisplay !== undefined) {
      toaster.style.display = visualWindow.__shipfoxToasterDisplay;
    }

    delete visualWindow.__shipfoxToasterDisplay;
    delete visualWindow.__shipfoxVisualRestore;
  });
}

async function applyReplacements(
  replacements: StableReplacement[],
  snapshots: LocatorSnapshot[],
): Promise<void> {
  for (const replacement of replacements) {
    const count = await replacement.locator.count();
    const locatorSnapshot: LocatorSnapshot = {
      elements: [],
    };
    snapshots.push(locatorSnapshot);

    for (let index = 0; index < count; index += 1) {
      const locator = replacement.locator.nth(index);
      const handle = await locator.elementHandle();
      if (!handle) {
        throw new Error(
          'Cannot apply stable screenshot replacements: locator element disappeared before capture.',
        );
      }

      let shouldDisposeHandle = true;
      try {
        const snapshot = await handle.evaluate(
          (
            element: MutableElement,
            options: {
              textReplacement: string | undefined;
              attributes: Record<string, string>;
              valueReplacement: string | undefined;
            },
          ): Omit<ElementSnapshot, 'handle'> => {
            const previous: Omit<ElementSnapshot, 'handle'> = {
              attributes: Object.fromEntries(
                Object.keys(options.attributes).map((name) => [name, element.getAttribute(name)]),
              ),
            };
            if (options.textReplacement !== undefined) previous.text = element.textContent;
            if (options.valueReplacement !== undefined && 'value' in element) {
              const currentValue = element.value;
              if (currentValue !== undefined) previous.value = currentValue;
            }

            if (options.textReplacement !== undefined)
              element.textContent = options.textReplacement;
            if (options.valueReplacement !== undefined && 'value' in element) {
              element.value = options.valueReplacement;
            }

            for (const [name, value] of Object.entries(options.attributes)) {
              element.setAttribute(name, value);
            }

            return previous;
          },
          {
            textReplacement: replacement.text,
            attributes: replacement.attributes ?? {},
            valueReplacement: replacement.value,
          },
        );
        locatorSnapshot.elements.push({...snapshot, handle});
        shouldDisposeHandle = false;
      } finally {
        if (shouldDisposeHandle) await handle.dispose();
      }
    }
  }
}

async function restoreSnapshots(snapshots: LocatorSnapshot[]): Promise<void> {
  let restoreError: unknown;

  for (const snapshot of [...snapshots].reverse()) {
    for (const elementSnapshot of [...snapshot.elements].reverse()) {
      try {
        const previous: Omit<ElementSnapshot, 'handle'> = {
          attributes: elementSnapshot.attributes,
        };
        if (elementSnapshot.text !== undefined) previous.text = elementSnapshot.text;
        if (elementSnapshot.value !== undefined) previous.value = elementSnapshot.value;
        await elementSnapshot.handle.evaluate(
          (element: MutableElement, previous: Omit<ElementSnapshot, 'handle'>) => {
            if (previous.text !== undefined) element.textContent = previous.text;
            if (previous.value !== undefined && 'value' in element) element.value = previous.value;

            for (const [name, value] of Object.entries(previous.attributes)) {
              if (value === null) element.removeAttribute(name);
              else element.setAttribute(name, value);
            }
          },
          previous,
        );
      } catch (error) {
        restoreError ??= error;
      } finally {
        await elementSnapshot.handle.dispose();
      }
    }
  }

  if (restoreError) throw restoreError;
}
