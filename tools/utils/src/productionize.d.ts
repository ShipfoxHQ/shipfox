export function productionizeImports(
  imports: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined;

export function productionizeExports(exportsField: unknown): unknown;

export function productionizeManifest<T extends Record<string, unknown>>(manifest: T): T;
