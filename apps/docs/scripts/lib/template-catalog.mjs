import {
  composeTemplate,
  extractModelAnchors,
  shippedTemplateLoader,
  templateRoleBindings,
} from '@shipfox/workflow-templates';
import {authoredTemplateMetadata} from '@/lib/template-catalog/authored';

export const TEMPLATE_CATALOG_DOCUMENT_ID = 'examples/catalog';

const OPTION_MARKER_PATTERN = /^\s*#\s*option:([a-z0-9_-]+)=([a-z0-9_-]+)\s+(begin|end)\s*$/;
const TRAILING_MARKER_PATTERN = /\s+# (?:bind|model):[a-z0-9_-]+\s*$/;
const EXTRA_BLANK_LINES_PATTERN = /\n{3,}/g;

/** Builds the examples document the docs pages read, from the templates the API ships. */
export function buildTemplateCatalogDocument() {
  return {
    id: TEMPLATE_CATALOG_DOCUMENT_ID,
    templates: [...shippedTemplateLoader.list()]
      .sort((a, b) => a.rank - b.rank)
      .map((template) => buildTemplateDetail(template)),
  };
}

function buildTemplateDetail(template) {
  const {manifest} = template;
  const bindings = templateRoleBindings(manifest.roles);
  const anchors = extractModelAnchors(composeTemplate(template, bindings.at(-1) ?? {}));
  const meta = authoredMetadata(template.id);

  return {
    ...buildEntry(template),
    prerequisites: meta.prerequisites,
    options: manifest.options,
    models: Object.entries(manifest.models).map(([key, model]) => ({
      key,
      note: model.note,
      model: anchors[key]?.model,
      thinking: anchors[key]?.thinking,
    })),
    variants: bindings.map((binding) => ({
      bindings: {...binding},
      yaml: applyDefaultOptions(composeTemplate(template, binding), manifest.options),
    })),
    related: (meta.related ?? []).map((id) => {
      const related = shippedTemplateLoader.get(id);
      if (!related)
        throw new Error(`Example "${template.id}" relates to unknown template "${id}".`);
      return buildEntry(related);
    }),
  };
}

function buildEntry(template) {
  const {manifest} = template;
  const meta = authoredMetadata(template.id);

  return {
    id: template.id,
    title: manifest.title,
    summary: manifest.summary,
    revision: template.revision,
    addedAt: template.added_at,
    group: meta.group,
    starts: meta.starts,
    flow: meta.flow,
    writes: meta.writes,
    roles: Object.entries(manifest.roles).map(([role, declaration]) => ({
      role,
      providers: declaration.providers,
      upcoming: meta.upcoming?.[role] ?? [],
      optional: declaration.optional === true,
      fromProject: declaration.from === 'project',
      question: declaration.question,
    })),
    href: `/examples/${template.id}`,
  };
}

function authoredMetadata(id) {
  const meta = authoredTemplateMetadata[id];
  if (!meta) throw new Error(`Template "${id}" has no example metadata in authored.ts.`);
  return meta;
}

// Keeps each option's default block, drops the others, and removes authoring markers,
// so readers see the workflow the agent would write with every default.
function applyDefaultOptions(yaml, options) {
  const defaults = new Map(
    options.map((option) => [
      option.id,
      (option.choices.find((choice) => choice.default) ?? option.choices[0])?.id,
    ]),
  );
  const open = [];
  const kept = [];
  for (const line of yaml.split('\n')) {
    const marker = OPTION_MARKER_PATTERN.exec(line);
    if (marker) {
      if (marker[3] === 'begin') open.push(defaults.get(marker[1]) === marker[2]);
      else open.pop();
      continue;
    }
    if (open.every(Boolean)) kept.push(line.replace(TRAILING_MARKER_PATTERN, ''));
  }
  return kept.join('\n').replace(EXTRA_BLANK_LINES_PATTERN, '\n\n');
}
