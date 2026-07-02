import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {config} from './config.js';

const templatesSource = fileURLToPath(new URL('../templates.e2e.yaml', import.meta.url));

interface TemplatesFile {
  templates: Record<string, Record<string, unknown>>;
}

/**
 * Writes a provisioner templates file with every template's image set to
 * E2E_RUNNER_IMAGE, returning its path. The checked-in templates.e2e.yaml owns the
 * labels and sizing; the image is overridden so the suite can target runner:ci
 * (default) or a published image without editing the source file.
 */
export function renderTemplatesFile(destination: string): string {
  const parsed = yaml.load(readFileSync(templatesSource, 'utf8')) as TemplatesFile;
  for (const template of Object.values(parsed.templates)) {
    template.image = config.E2E_RUNNER_IMAGE;
  }
  writeFileSync(destination, yaml.dump(parsed));
  return destination;
}
