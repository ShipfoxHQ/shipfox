import {config} from '@/config';
import {RegistryApi} from './registry-api';

export const registry = new RegistryApi(config.REGISTRY_URL);
