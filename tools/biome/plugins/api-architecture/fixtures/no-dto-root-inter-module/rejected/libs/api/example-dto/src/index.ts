import '@shipfox/a-dto/inter-module/side-effect';

import * as clients from '@shipfox/a-dto/inter-module/namespace';
import {client as aliasedClient} from '@shipfox/a-dto/inter-module/runtime';
import type {Client} from '@shipfox/a-dto/inter-module/types';

export * from '@shipfox/a-dto/inter-module/all';
export {client} from '@shipfox/a-dto/inter-module/export';
export type {Client} from '@shipfox/a-dto/inter-module/export-types';

const dynamicClient = import('@shipfox/a-dto/inter-module/dynamic');
type ImportedClient = import('@shipfox/a-dto/inter-module/import-type').Client;

void aliasedClient;
void clients;
void dynamicClient;

export type {Client, ImportedClient};
