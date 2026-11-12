import {logger} from '@shipfox/node-opentelemetry';
import {type DuplicateCopy, duplicatePackageCopies} from '@shipfox/node-process-state';

/**
 * Logs one warning per package that is installed more than once in this process. In strict mode,
 * throws when any package has more than one copy. Copies that share their state slots still have
 * their own classes, so `instanceof` fails across them.
 */
export function reportDuplicatePackageCopies(options: {strict: boolean}): void {
  const duplicates = duplicatePackageCopies();
  for (const duplicate of duplicates) {
    logger().warn(
      {
        package: duplicate.packageName,
        installFolders: installFolders(duplicate),
        sharesState: duplicate.sharesState,
      },
      duplicate.sharesState
        ? `Package ${duplicate.packageName} is installed more than once; the copies share their state`
        : `Package ${duplicate.packageName} is installed more than once; the copies do not share their state`,
    );
  }

  if (!options.strict || duplicates.length === 0) return;
  throw new Error(
    `These packages are installed more than once: ${duplicates
      .map((duplicate) => `${duplicate.packageName} (${installFolders(duplicate).join(', ')})`)
      .join('; ')}`,
  );
}

function installFolders(duplicate: DuplicateCopy): string[] {
  return duplicate.copies.map((copy) => copy.installFolder);
}
