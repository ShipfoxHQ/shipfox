import {resolve} from 'node:path';
import {compileEmailTemplates} from './compile.js';

const args = process.argv.slice(2);
const [sourceDir, outDir] = args;
if (args.length !== 2 || !sourceDir || !outDir) {
  process.stderr.write('Usage: shipfox-email-compile <source-dir> <out-dir>\n');
  process.exit(1);
}

try {
  await compileEmailTemplates({sourceDir: resolve(sourceDir), outDir: resolve(outDir)});
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
