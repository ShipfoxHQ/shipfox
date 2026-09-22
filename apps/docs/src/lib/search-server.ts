import {createFromSource} from 'fumadocs-core/search/server';
import {source} from '@/lib/source';

// One index backs both the search dialog and the Ask AI retrieval tool, so a
// page is tokenized once per server instance.
export const searchServer = createFromSource(source, {
  // https://docs.orama.com/open-source/supported-languages
  language: 'english',
});
