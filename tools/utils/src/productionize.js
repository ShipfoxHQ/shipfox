const SOURCE_CONDITIONS = new Set(['development', 'workspace-source']);
const IMPORT_SOURCE_CONDITIONS = new Set([...SOURCE_CONDITIONS, 'types']);

/**
 * Removes source-only package conditions from a manifest target while preserving
 * references that do not need productionization.
 */
function productionizeTarget(target, excludedConditions = SOURCE_CONDITIONS) {
  if (typeof target === 'string' || target === null || typeof target !== 'object') {
    return target;
  }

  if (Array.isArray(target)) {
    let changed = false;
    const productionized = target.map((value) => {
      const result = productionizeTarget(value, excludedConditions);
      if (result !== value) changed = true;
      return result;
    });
    return changed ? productionized : target;
  }

  let changed = false;
  const productionized = {};
  for (const [condition, value] of Object.entries(target)) {
    if (excludedConditions.has(condition)) {
      changed = true;
      continue;
    }

    const result = productionizeTarget(value, excludedConditions);
    if (result !== value) changed = true;
    productionized[condition] = result;
  }

  if (!changed) return target;
  if (Object.keys(productionized).length === 1 && 'default' in productionized) {
    return productionized.default;
  }
  return productionized;
}

export function productionizeImports(imports) {
  if (!imports) return imports;

  const productionized = productionizeTarget(imports, IMPORT_SOURCE_CONDITIONS);
  const subpathImports = imports['#*'];
  const hasDistDefault =
    subpathImports &&
    typeof subpathImports === 'object' &&
    !Array.isArray(subpathImports) &&
    subpathImports.default === './dist/*';
  if (subpathImports !== './src/*' && !hasDistDefault) return productionized;

  return {...productionized, '#*': './dist/*'};
}

export function productionizeExports(exportsField) {
  return productionizeTarget(exportsField);
}

export function productionizeManifest(manifest) {
  const imports = productionizeImports(manifest.imports);
  const exportsField = productionizeExports(manifest.exports);
  if (imports === manifest.imports && exportsField === manifest.exports) return manifest;

  return {...manifest, imports, exports: exportsField};
}
