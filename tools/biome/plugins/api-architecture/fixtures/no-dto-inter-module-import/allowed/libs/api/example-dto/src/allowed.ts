import '@shipfox/a-dto/contracts/side-effect';

import * as clients from '@shipfox/a-dto/contracts/namespace';
import {client as aliasedClient} from '@shipfox/a-dto/contracts/runtime';
import type {Client} from '@shipfox/a-dto/contracts/types';

export * from '@shipfox/a-dto/contracts/all';
export {client} from '@shipfox/a-dto/contracts/export';
export type {Client} from '@shipfox/a-dto/contracts/export-types';

const dynamicClient = import('@shipfox/a-dto/contracts/dynamic');
type ImportedClient = import('@shipfox/a-dto/contracts/import-type').Client;

void aliasedClient;
void clients;
void dynamicClient;

export type {Client, ImportedClient};
