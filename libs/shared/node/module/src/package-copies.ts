import {logger} from '@shipfox/node-opentelemetry';
import {type DuplicateCopy, duplicatePackageCopies} from '@shipfox/node-process-state';

/**
 * Logs one warning per package that is installed more than once in this process. In strict mode,
 * throws when the copies of any package do not share their state.
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

  if (!options.strict) return;
  const divergent = duplicates.filter((duplicate) => !duplicate.sharesState);
  if (divergent.length === 0) return;
  throw new Error(
    `Installed copies of these packages do not share their state: ${divergent
      .map((duplicate) => `${duplicate.packageName} (${installFolders(duplicate).join(', ')})`)
      .join('; ')}`,
  );
}

function installFolders(duplicate: DuplicateCopy): string[] {
  return duplicate.copies.map((copy) => copy.installFolder);
}
