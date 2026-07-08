import {defineConfig, defineDocs, frontmatterSchema, metaSchema} from 'fumadocs-mdx/config';
import {z} from 'zod';

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
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {},
});
