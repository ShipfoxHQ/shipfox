import {generateContractFiles} from './contract-generator.js';
import {defaultOutputRoot, writeContractFiles} from './contract-output.js';
import {loadContracts} from './contracts.js';

const generated = generateContractFiles(await loadContracts());
await writeContractFiles({generated});
process.stdout.write(`Wrote ${generated.length} contract workflow files to ${defaultOutputRoot}\n`);
