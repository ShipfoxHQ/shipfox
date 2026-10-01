import {mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';

// The repository README can't render the introduction diagram's markup, so it embeds
// screenshots of it. Run this against a running docs server after changing the diagram.

const docsUrl = process.env.DOCS_URL ?? `http://localhost:${process.env.SHIPFOX_DOCS_PORT ?? 3500}`;
const outputDir = new URL('../public/readme/', import.meta.url);

// Wide enough for the horizontal step layout, narrow enough to fit GitHub's README column.
const diagramWidth = 880;

await mkdir(outputDir, {recursive: true});
const browser = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({
      colorScheme,
      deviceScaleFactor: 2,
      viewport: {width: 1440, height: 1200},
    });
    await page.goto(docsUrl, {waitUntil: 'networkidle'});
    // A transparent page lets the image sit on GitHub's own background in both themes.
    await page.addStyleTag({
      content: `html, body { background: transparent !important; }
        figure:has(> figcaption) { width: ${diagramWidth}px !important; max-width: none !important; }`,
    });
    await page.evaluate(() => document.fonts.ready);
    const diagram = page.locator('figure', {hasText: 'How a Shipfox workflow runs'});
    await diagram.screenshot({
      path: new URL(`workflow-overview-${colorScheme}.png`, outputDir).pathname,
      omitBackground: true,
      animations: 'disabled',
    });
    await page.close();
  }
} finally {
  await browser.close();
}
