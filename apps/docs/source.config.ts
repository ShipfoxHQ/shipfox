import {defineConfig, defineDocs, frontmatterSchema, metaSchema} from 'fumadocs-mdx/config';
import {z} from 'zod';
import {
  INTEGRATION_CATALOG_CAPABILITIES,
  INTEGRATION_CATALOG_CATEGORIES,
  INTEGRATION_CATALOG_ICONS,
} from './src/lib/integration-catalog';
import {stringifyMachineReadableComponent} from './src/lib/machine-readable';
import {remarkGeneratedComponents} from './src/lib/remark-generated-components';
import {remarkRunnerCatalog} from './src/lib/remark-runner-catalog';

export type {z} from 'zod';

// The page `title` stays the descriptive/SEO heading (H1 + browser title). The
// sidebar shows `sidebarTitle` instead (shorter, e.g. "Jobs, Steps & Agents"),
// and `status` renders a badge next to it (e.g. "soon"). Both are applied to the
// page tree by plugins in `src/lib/source.ts`.
export const docs = defineDocs({
  docs: {
    schema: frontmatterSchema.extend({
      sidebarTitle: z.string().optional(),
      status: z.string().optional(),
      // Generated reference document ids, such as `integrations/jira/tools`.
      toolReference: z.string().optional(),
      eventReference: z.string().optional(),
      // A `full` page hides the table of contents by default. Set this to keep it.
      tableOfContent: z.boolean().optional(),
      catalog: z
        .object({
          name: z.string(),
          summary: z.string(),
          capabilities: z.array(z.enum(INTEGRATION_CATALOG_CAPABILITIES)),
          categories: z.array(z.enum(INTEGRATION_CATALOG_CATEGORIES)),
          aliases: z.array(z.string()),
          icon: z.enum(INTEGRATION_CATALOG_ICONS),
        })
        .optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: {
        mdxAsPlaceholder: ['IntegrationCatalog', 'ToolReference', 'EventReference'],
        stringify: stringifyMachineReadableComponent,
      },
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkImageOptions: {useImport: false},
    remarkPlugins: [remarkGeneratedComponents, remarkRunnerCatalog],
  },
});
