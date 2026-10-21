import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

// The repository README can't render the introduction diagrams' markup, so it embeds
// screenshots of them. Run this against a running docs server after changing a diagram.

const docsUrl = process.env.DOCS_URL ?? `http://localhost:${process.env.SHIPFOX_DOCS_PORT ?? 3500}`;
const outputDir = new URL('../public/readme/', import.meta.url);

// Wide enough for the horizontal step layout, narrow enough to fit GitHub's README column.
const diagramWidth = 880;

// Each diagram is found by its figure caption.
const diagrams = [
  {caption: 'How Shippy AI improves your workflows', file: 'improvement-loop'},
  {caption: 'How a Shipfox workflow runs', file: 'workflow-overview'},
];

// GitHub's Primer colors replace the docs neutrals so the diagram sits naturally in the README.
// Cards use the muted background GitHub gives code blocks. The orange accent stays.
const githubPalette = {
  light: {
    foreground: '#1f2328',
    'muted-foreground': '#59636e',
    card: '#f6f8fa',
    border: '#d1d9e0',
  },
  dark: {
    foreground: '#f0f6fc',
    'muted-foreground': '#9198a1',
    card: '#151b23',
    border: '#3d444d',
  },
};

await mkdir(outputDir, {recursive: true});
const browser = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({
      colorScheme,
      // The improvement loop renders its final frame instead of playing.
      reducedMotion: 'reduce',
      deviceScaleFactor: 2,
      viewport: {width: 1440, height: 1200},
    });
    await page.goto(docsUrl, {waitUntil: 'networkidle'});
    // A transparent page lets the image sit on GitHub's own background in both themes. The
    // doubled :root outranks the docs theme's .dark selector.
    await page.addStyleTag({
      content: `:root:root { ${Object.entries(githubPalette[colorScheme])
        .map(([token, color]) => `--color-fd-${token}: ${color};`)
        .join(' ')} }
        html, body { background: transparent !important; }
        figure:has(> figcaption) { width: ${diagramWidth}px !important; max-width: none !important; }`,
    });
    await page.evaluate(() => document.fonts.ready);
    for (const {caption, file} of diagrams) {
      await page.locator('figure', {hasText: caption}).screenshot({
        path: fileURLToPath(new URL(`${file}-${colorScheme}.png`, outputDir)),
        omitBackground: true,
        animations: 'disabled',
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
