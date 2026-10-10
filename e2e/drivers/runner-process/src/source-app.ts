import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';

/**
 * Resolves the directory of a Shipfox app that source mode runs through tsx. The apps are
 * not published, so this package does not depend on them: the suite that uses source mode
 * declares the app, and the lookup falls back to the suite's working directory.
 */
export function resolveSourceAppDirectory(packageName: string): string {
  const origins = [import.meta.url, join(process.cwd(), 'package.json')];
  for (const origin of origins) {
    try {
      return dirname(createRequire(origin).resolve(`${packageName}/package.json`));
    } catch {
      // Try the next origin.
    }
  }
  throw new Error(
    `Source mode needs ${packageName}, which is not installed. Inside the Shipfox repository, add it to the package.json of the suite. Anywhere else, start capacity with mode: 'image'.`,
  );
}
