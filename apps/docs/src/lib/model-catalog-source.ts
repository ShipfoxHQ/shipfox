import 'server-only';

import {config} from '@/config';
import {createModelCatalogClient} from '@/lib/model-catalog';

const modelCatalogClient = createModelCatalogClient({
  apiUrl: config.API_PUBLIC_URL,
});

export const getModelCatalog = () => modelCatalogClient.getModelCatalog();
