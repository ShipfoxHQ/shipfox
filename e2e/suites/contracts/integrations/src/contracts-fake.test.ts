import {afterAll, beforeAll, describe, it} from '@shipfox/vitest/vi';
import {loadContracts} from './contracts.js';
import {type ContractStack, fakeCasesByProvider, startContractStack} from './stack.js';

const files = await loadContracts();
const cleanups: Array<() => Promise<void>> = [];
let stack: ContractStack;

beforeAll(async () => {
  stack = await startContractStack({files, cleanups});
});

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
});

// Each provider's cases share its fake, so they run in order and a write stays out of the
// way of another case's read through the marker in its name.
describe.each([...fakeCasesByProvider(files)])('%s fake', (_provider, cases) => {
  it.each(cases.map((loaded) => ({id: loaded.id, loaded})))('$id', async ({loaded}) => {
    await stack.run(loaded);
  });
});
