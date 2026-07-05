import {argosScreenshot, type Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;

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

interface ElementSnapshot {
  text?: string | null;
  value?: string;
  attributes: Record<string, string | null>;
}

interface LocatorSnapshot {
  locator: Locator;
  count: number;
  elements: ElementSnapshot[];
}

export async function stableScreenshot(
  page: Page,
  name: string,
  replacements: StableReplacement[] = [],
): Promise<void> {
  const snapshots: LocatorSnapshot[] = [];

  try {
    await applyReplacements(replacements, snapshots);
    await argosScreenshot(page, name);
  } finally {
    if (snapshots.length > 0) await restoreSnapshots(snapshots);
  }
}

async function applyReplacements(
  replacements: StableReplacement[],
  snapshots: LocatorSnapshot[],
): Promise<void> {
  for (const replacement of replacements) {
    const count = await replacement.locator.count();
    const locatorSnapshot: LocatorSnapshot = {
      locator: replacement.locator,
      count,
      elements: [],
    };
    snapshots.push(locatorSnapshot);

    for (let index = 0; index < count; index += 1) {
      const locator = replacement.locator.nth(index);
      const snapshot = await locator.evaluate(
        (
          element: MutableElement,
          options: {
            textReplacement: string | undefined;
            attributeNames: string[];
            valueReplacement: string | undefined;
          },
        ): ElementSnapshot => {
          const previous: ElementSnapshot = {
            attributes: Object.fromEntries(
              options.attributeNames.map((name) => [name, element.getAttribute(name)]),
            ),
          };
          if (options.textReplacement !== undefined) previous.text = element.textContent;
          if (options.valueReplacement !== undefined && 'value' in element) {
            const currentValue = element.value;
            if (currentValue !== undefined) previous.value = currentValue;
          }

          if (options.textReplacement !== undefined) element.textContent = options.textReplacement;
          if (options.valueReplacement !== undefined && 'value' in element) {
            element.value = options.valueReplacement;
          }

          return previous;
        },
        {
          textReplacement: replacement.text,
          attributeNames: Object.keys(replacement.attributes ?? {}),
          valueReplacement: replacement.value,
        },
      );
      locatorSnapshot.elements.push(snapshot);

      if (replacement.attributes) {
        await locator.evaluate((element: MutableElement, attributes: Record<string, string>) => {
          for (const [name, value] of Object.entries(attributes)) {
            element.setAttribute(name, value);
          }
        }, replacement.attributes);
      }
    }
  }
}

async function restoreSnapshots(snapshots: LocatorSnapshot[]): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) {
    const currentCount = await snapshot.locator.count();
    if (currentCount !== snapshot.count) {
      throw new Error(
        `Cannot restore stable screenshot replacements: locator matched ${currentCount} elements after capture, but matched ${snapshot.count} before capture.`,
      );
    }

    for (let index = 0; index < snapshot.elements.length; index += 1) {
      await snapshot.locator
        .nth(index)
        .evaluate((element: MutableElement, previous: ElementSnapshot) => {
          if (previous.text !== undefined) element.textContent = previous.text;
          if (previous.value !== undefined && 'value' in element) element.value = previous.value;

          for (const [name, value] of Object.entries(previous.attributes)) {
            if (value === null) element.removeAttribute(name);
            else element.setAttribute(name, value);
          }
        }, snapshot.elements[index] as ElementSnapshot);
    }
  }
}
